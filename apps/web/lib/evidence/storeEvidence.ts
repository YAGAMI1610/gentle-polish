import { createHash } from "node:crypto";
import type { Evidence } from "@prisma/client";
import { createEvidence, getEvidence } from "@/lib/db";
import { storeEvidenceInput, type StoreEvidenceInput } from "@/lib/db/schemas";
import type { EvidenceBlob, EvidenceStorage } from "@/lib/storage";
import { getEvidenceStorage } from "@/lib/storage";
import { hardenEvidenceBytes } from "./hardening";
import type { EvidenceHardeningReport, MalwareScanner } from "./hardening";

/**
 * Evidence upload/storage pipeline (build sequence §14.7).
 *
 * The seam between an incoming submission and the two places it is recorded: the
 * off-chain blob store (`EvidenceStorage`) for raw bytes, and the wallet-scoped
 * `Evidence` row for the pointer + hash. It exists so the eventual HTTP upload
 * route (step 9, once SIWE + CSRF are in place — LIMITATIONS §4) is a thin wrapper
 * over already-tested logic, and so every write path enforces the same invariants:
 *
 *   - Raw bytes/text go off-chain ONLY; the row keeps a `storageKey` + `contentHash`
 *     and only the hash is ever eligible to be anchored on-chain (§9/§10).
 *   - Ownership is enforced downstream by `createEvidence`, which throws
 *     `WalletScopeError` if the goal/check-in is not this wallet's.
 *   - `contentText` is untrusted data (rule 5): hashed and stored, never interpreted.
 */

/** Hard cap on a single evidence blob. Generous for photos/PDFs, bounded so a
 *  submission cannot exhaust disk. Stricter per-type limits can layer on later. */
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

/** MIME allowlist for binary evidence. Unknown/none is treated as opaque bytes;
 *  clearly-executable types are refused. The declared type is only the FIRST gate —
 *  `hardening/` then sniffs the real bytes, scans them, and strips metadata
 *  (LIMITATIONS §13, item 10). */
const ALLOWED_MIME_PREFIXES = ["image/", "text/"] as const;
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/json",
  "application/octet-stream",
]);

/**
 * Active-content types refused despite matching an allowed prefix. `text/html` and
 * `image/svg+xml` are scriptable: served from our own origin they are stored-XSS
 * vectors (the `[id]` route also forces `attachment` + `nosniff` — defence in depth,
 * and this closes the deliberate gap recorded in LIMITATIONS §22.3).
 */
const DENIED_ACTIVE_MIMES = new Set([
  "text/html",
  "text/xml",
  "text/javascript",
  "text/x-shellscript",
  "image/svg+xml",
  "application/xhtml+xml",
  "application/xml",
  "application/javascript",
  "application/ecmascript",
  "application/x-httpd-php",
]);

export interface StoreEvidenceArgs extends StoreEvidenceInput {
  /** Binary payload for photo/screenshot/file evidence. Omit for text/reference claims. */
  readonly bytes?: Uint8Array;
}

/**
 * Store one piece of evidence and return its persisted row.
 *
 * `bytes` present → stored off-chain via `EvidenceStorage`, row references it by
 * `storageKey` + `contentHash`. Otherwise `contentText` is required → hashed
 * (sha256) and kept off-chain in the row. Exactly one payload kind must be present.
 */
export interface StoreEvidenceOptions {
  /**
   * Malware scanner for the hardening pass. Omit to use the configured one
   * (`EVIDENCE_MALWARE_SCAN`); pass `null` to skip scanning explicitly.
   */
  readonly scanner?: MalwareScanner | null;
  /** Optional sink for the hardening report (what was sniffed/removed/scanned). */
  readonly onHardened?: (report: EvidenceHardeningReport) => void;
}

export async function storeEvidence(
  walletAddress: string,
  args: StoreEvidenceArgs,
  storage: EvidenceStorage = getEvidenceStorage(),
  options: StoreEvidenceOptions = {},
): Promise<Evidence> {
  const meta = storeEvidenceInput.parse(args);
  const hasBytes = args.bytes !== undefined && args.bytes.byteLength > 0;
  const hasText = meta.contentText !== undefined && meta.contentText.length > 0;

  if (hasBytes === hasText) {
    throw new Error(
      "storeEvidence requires exactly one payload: either `bytes` (binary) or `contentText` (text)",
    );
  }

  if (hasBytes) {
    const bytes = args.bytes as Uint8Array;
    if (bytes.byteLength > MAX_EVIDENCE_BYTES) {
      throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} byte limit`);
    }
    assertAllowedMime(meta.mimeType);

    // Content hardening (§13, item 10) BEFORE hashing or storing: sniff the real
    // bytes and hold the declared type to them, malware-scan the original, then
    // strip EXIF/metadata. What comes back is what gets hashed and stored, so
    // `contentHash` describes exactly the bytes in the blob store.
    const hardened = await hardenEvidenceBytes(
      {
        bytes,
        ...(meta.mimeType !== undefined ? { mimeType: meta.mimeType } : {}),
        ...(meta.fileName !== undefined ? { fileName: meta.fileName } : {}),
      },
      options.scanner === undefined ? {} : { scanner: options.scanner },
    );
    // The corroborated type must clear the same allowlist as the declared one.
    assertAllowedMime(hardened.mimeType);
    options.onHardened?.(hardened.report);

    const effectiveMime = hardened.mimeType;
    const stored = await storage.put({
      walletAddress,
      bytes: hardened.bytes,
      ...(effectiveMime !== undefined ? { mimeType: effectiveMime } : {}),
      ...(meta.fileName !== undefined ? { fileName: meta.fileName } : {}),
    });

    return createEvidence(walletAddress, {
      goalId: meta.goalId,
      type: meta.type,
      storageKey: stored.storageKey,
      contentHash: stored.contentHash,
      sizeBytes: stored.sizeBytes,
      ...(effectiveMime !== undefined ? { mimeType: effectiveMime } : {}),
      ...(meta.fileName !== undefined ? { fileName: meta.fileName } : {}),
      ...(meta.checkInId !== undefined ? { checkInId: meta.checkInId } : {}),
    });
  }

  // Text/reference claim: no blob, hash the text so it too gets an anchorable digest.
  const text = meta.contentText as string;
  const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
  return createEvidence(walletAddress, {
    goalId: meta.goalId,
    type: meta.type,
    contentText: text,
    contentHash,
    sizeBytes: Buffer.byteLength(text, "utf8"),
    ...(meta.checkInId !== undefined ? { checkInId: meta.checkInId } : {}),
  });
}

/**
 * Read the raw blob behind a piece of evidence, scoped to the owner.
 *
 * Returns null both when the evidence is not this wallet's AND when it exists but
 * has no blob (a text claim) — a caller can never distinguish "not yours" from
 * "no blob" from "absent". This is the privacy-scoped retrieval the tests exercise.
 */
export async function readEvidenceBlob(
  walletAddress: string,
  evidenceId: string,
  storage: EvidenceStorage = getEvidenceStorage(),
): Promise<EvidenceBlob | null> {
  const evidence = await getEvidence(walletAddress, evidenceId);
  if (!evidence || !evidence.storageKey) return null;
  return storage.get(evidence.storageKey);
}

function assertAllowedMime(mimeType: string | undefined): void {
  if (!isAllowedEvidenceMime(mimeType)) {
    throw new Error(`evidence MIME type not allowed: ${mimeType}`);
  }
}

/**
 * True when a MIME type is acceptable for binary evidence (undefined = opaque
 * bytes, allowed). Exported so the HTTP upload boundary can reject a disallowed
 * type with a 415 BEFORE calling `storeEvidence`, reusing this one allowlist
 * instead of duplicating it. `storeEvidence` still enforces it internally.
 */
export function isAllowedEvidenceMime(mimeType: string | undefined): boolean {
  if (mimeType === undefined) return true; // opaque bytes are allowed
  const mt = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (DENIED_ACTIVE_MIMES.has(mt)) return false;
  if (ALLOWED_MIME_EXACT.has(mt)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => mt.startsWith(p));
}
