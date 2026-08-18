import { join } from "node:path";
import type { EvidenceStorage } from "./EvidenceStorage";
import { LocalDiskEvidenceStorage } from "./localDiskStorage";

export type {
  EvidenceStorage,
  EvidenceBlob,
  EvidencePutInput,
  EvidencePutResult,
} from "./EvidenceStorage";
export { LocalDiskEvidenceStorage } from "./localDiskStorage";

/**
 * Resolve the configured `EvidenceStorage` driver (build-prompt §1).
 *
 * `EVIDENCE_STORAGE_DRIVER` selects the backend; `local` (the default, and the only
 * driver shipped this build) writes off-chain blobs under `EVIDENCE_STORAGE_DIR`.
 * An S3/Supabase driver is anticipated behind the same interface — adding it is a new
 * case here plus a new class, with no change to the evidence pipeline (see LIMITATIONS).
 */

let singleton: EvidenceStorage | undefined;

export function getEvidenceStorage(): EvidenceStorage {
  if (singleton) return singleton;

  const driver = (process.env["EVIDENCE_STORAGE_DRIVER"] ?? "local").trim().toLowerCase();
  switch (driver) {
    case "local": {
      const dir =
        process.env["EVIDENCE_STORAGE_DIR"]?.trim() || join(process.cwd(), ".evidence-store");
      singleton = new LocalDiskEvidenceStorage(dir);
      return singleton;
    }
    // case "s3": an S3-compatible driver lands here behind the same interface (LIMITATIONS §step-7).
    default:
      throw new Error(
        `unknown EVIDENCE_STORAGE_DRIVER "${driver}" — supported: "local" (S3 driver is deferred, see LIMITATIONS.md)`,
      );
  }
}

/** Test seam: reset the memoized driver so a test can point at a temp dir. */
export function __resetEvidenceStorageForTests(): void {
  singleton = undefined;
}
