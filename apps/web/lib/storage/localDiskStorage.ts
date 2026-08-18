import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type {
  EvidenceBlob,
  EvidencePutInput,
  EvidencePutResult,
  EvidenceStorage,
} from "./EvidenceStorage";

/**
 * Local-disk `EvidenceStorage` driver (build-prompt §1 — "local disk or S3-compatible
 * bucket behind an EvidenceStorage interface").
 *
 * Layout under the configured root:
 *   <root>/wallet/<addr>/<sha256>            the raw blob
 *   <root>/wallet/<addr>/<sha256>.meta.json  { mimeType?, fileName?, sizeBytes }
 *
 * Content-addressed: the key derives from sha256(bytes), so identical bytes for one
 * wallet map to one blob (idempotent, natural dedupe). Wallet-namespaced: the address
 * is a path segment, so one wallet's key can never resolve into another's tree, and
 * the key itself encodes ownership.
 *
 * This is off-chain storage only (§9). The bytes never leave disk except via `get`,
 * which callers gate behind wallet-scoped ownership before they ever hold a key.
 */

const KEY_PATTERN = /^wallet\/0x[0-9a-f]{40}\/[0-9a-f]{64}$/;

interface BlobMeta {
  mimeType?: string;
  fileName?: string;
  sizeBytes: number;
}

export class LocalDiskEvidenceStorage implements EvidenceStorage {
  private readonly root: string;

  constructor(root: string) {
    // Absolute, normalized root so every derived path can be checked against it.
    this.root = resolve(root);
  }

  async put(input: EvidencePutInput): Promise<EvidencePutResult> {
    const addr = normalizeAddress(input.walletAddress);
    const contentHash = createHash("sha256").update(input.bytes).digest("hex");
    const storageKey = `wallet/${addr}/${contentHash}`;
    const sizeBytes = input.bytes.byteLength;

    const blobPath = this.pathFor(storageKey);
    await mkdir(dirname(blobPath), { recursive: true });
    // Content-addressed: same bytes → same path, so a rewrite is a no-op in effect.
    await writeFile(blobPath, input.bytes);

    const meta: BlobMeta = { sizeBytes };
    if (input.mimeType !== undefined) meta.mimeType = input.mimeType;
    if (input.fileName !== undefined) meta.fileName = input.fileName;
    await writeFile(`${blobPath}.meta.json`, JSON.stringify(meta), "utf8");

    return { storageKey, contentHash, sizeBytes };
  }

  async get(storageKey: string): Promise<EvidenceBlob | null> {
    const blobPath = this.pathFor(storageKey);
    let bytes: Buffer;
    try {
      bytes = await readFile(blobPath);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }

    let mimeType: string | undefined;
    try {
      const meta = JSON.parse(await readFile(`${blobPath}.meta.json`, "utf8")) as BlobMeta;
      mimeType = meta.mimeType;
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // Missing sidecar is tolerable — the bytes are the source of truth.
    }

    return mimeType !== undefined ? { bytes, mimeType } : { bytes };
  }

  async delete(storageKey: string): Promise<void> {
    const blobPath = this.pathFor(storageKey);
    // `force` makes a missing path a no-op, so delete is idempotent.
    await rm(blobPath, { force: true });
    await rm(`${blobPath}.meta.json`, { force: true });
  }

  /**
   * Resolve a storage key to an on-disk path, rejecting anything that is not a
   * well-formed key or that would escape the root (defence-in-depth against a
   * malformed/hostile key ever reaching the filesystem).
   */
  private pathFor(storageKey: string): string {
    if (!KEY_PATTERN.test(storageKey)) {
      throw new Error(`invalid evidence storage key: ${storageKey}`);
    }
    const full = resolve(this.root, storageKey);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error("evidence storage key escapes the storage root");
    }
    return join(this.root, storageKey);
  }
}

function normalizeAddress(address: string): string {
  const addr = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    throw new Error("evidence storage requires a 0x-prefixed 40-hex wallet address");
  }
  return addr;
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
