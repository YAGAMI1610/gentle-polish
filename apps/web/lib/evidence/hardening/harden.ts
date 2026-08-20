/**
 * The evidence content-hardening boundary (LIMITATIONS §13, item 10).
 *
 * One function, called by `storeEvidence` before anything is hashed or written, so
 * EVERY write path (the HTTP upload route and the GitHub connector import alike)
 * gets the same treatment and none can bypass it.
 *
 * Order matters:
 *   1. **Sniff + policy** (`assertSniffedContentAllowed`) — cheapest, and it rejects
 *      the whole dangerous-content class (executables, archives, HTML/SVG, spoofed
 *      types) before we spend anything else on the payload.
 *   2. **Malware scan of the ORIGINAL bytes** — deliberately before scrubbing: a
 *      signature hiding in an EXIF blob should get the upload REFUSED, not silently
 *      sanitised into looking clean. Scrubbing only ever removes bytes, so scanning
 *      the original also covers everything we keep. Fail-closed when configured.
 *   3. **Metadata scrub** — strip EXIF/GPS/XMP/comments, then hand back the bytes
 *      the caller must hash and store.
 *
 * The returned `bytes` — not the upload's — are what `storeEvidence` hashes, so the
 * anchorable `contentHash` always describes exactly what sits in the blob store.
 */
import { scrubImageMetadata } from "./metadata";
import { assertSniffedContentAllowed } from "./sniff";
import { getMalwareScanner, type MalwareScanner } from "./scanner";
import { EvidenceMalwareDetectedError } from "../errors";

export interface EvidenceHardeningReport {
  /** What the bytes actually are, per the sniffer. */
  readonly sniffedMimeType: string;
  /** Short format label, e.g. "png"/"jpeg"/"text". */
  readonly sniffedFormat: string;
  /** What the client claimed, when it claimed anything. */
  readonly declaredMimeType?: string;
  /** Metadata blocks removed, e.g. `["jpeg:APP1(Exif)"]`. Empty = nothing to strip. */
  readonly metadataRemoved: readonly string[];
  /** True only when a scanner actually returned a clean verdict. */
  readonly scanned: boolean;
  /** Which scanner produced that verdict. */
  readonly scanner?: string;
  readonly originalSizeBytes: number;
  readonly storedSizeBytes: number;
}

export interface HardenedEvidence {
  /** Sanitised bytes to hash and store. */
  readonly bytes: Uint8Array;
  /** The corroborated MIME type to record on the row. */
  readonly mimeType: string | undefined;
  readonly report: EvidenceHardeningReport;
}

export interface HardenEvidenceOptions {
  /**
   * Scanner to use. Omit to resolve the configured one from the environment;
   * pass `null` to scan nothing (what an "off" configuration resolves to).
   */
  readonly scanner?: MalwareScanner | null;
}

/**
 * Harden one binary evidence payload. Throws `EvidenceContentRejectedError` (415),
 * `EvidenceMalwareDetectedError` (422), or `EvidenceScanUnavailableError` (503) —
 * all mapped by `toHttpError`.
 */
export async function hardenEvidenceBytes(
  input: {
    readonly bytes: Uint8Array;
    readonly mimeType?: string | undefined;
    readonly fileName?: string | undefined;
  },
  options: HardenEvidenceOptions = {},
): Promise<HardenedEvidence> {
  const { effectiveMimeType, sniffed } = assertSniffedContentAllowed({
    bytes: input.bytes,
    declaredMimeType: input.mimeType,
  });

  const scanner = options.scanner === undefined ? getMalwareScanner() : options.scanner;
  let scanned = false;
  let scannerName: string | undefined;
  if (scanner) {
    const verdict = await scanner.scan({
      bytes: input.bytes,
      ...(input.fileName !== undefined ? { fileName: input.fileName } : {}),
      ...(effectiveMimeType !== undefined ? { mimeType: effectiveMimeType } : {}),
    });
    if (!verdict.clean) {
      throw new EvidenceMalwareDetectedError(verdict.scanner, verdict.signature);
    }
    scanned = true;
    scannerName = verdict.scanner;
  }

  const scrubbed = scrubImageMetadata(input.bytes, sniffed.label);

  return {
    bytes: scrubbed.bytes,
    mimeType: effectiveMimeType,
    report: {
      sniffedMimeType: sniffed.mimeType,
      sniffedFormat: sniffed.label,
      ...(input.mimeType !== undefined ? { declaredMimeType: input.mimeType } : {}),
      metadataRemoved: scrubbed.removed,
      scanned,
      ...(scannerName !== undefined ? { scanner: scannerName } : {}),
      originalSizeBytes: input.bytes.byteLength,
      storedSizeBytes: scrubbed.bytes.byteLength,
    },
  };
}
