import { join } from "node:path";
import type { EvidenceStorage } from "./EvidenceStorage";
import { LocalDiskEvidenceStorage } from "./localDiskStorage";
import { readS3Credentials, readS3StorageConfig } from "./s3/config";
import { S3EvidenceStorage } from "./s3/s3Storage";

export type {
  EvidenceStorage,
  EvidenceBlob,
  EvidencePutInput,
  EvidencePutResult,
} from "./EvidenceStorage";
export { LocalDiskEvidenceStorage } from "./localDiskStorage";
export { S3EvidenceStorage } from "./s3/s3Storage";

/**
 * Resolve the configured `EvidenceStorage` driver (build-prompt §1).
 *
 * `EVIDENCE_STORAGE_DRIVER` selects the backend:
 *  - `local` (default) writes off-chain blobs under `EVIDENCE_STORAGE_DIR`.
 *  - `s3` uses any S3-compatible bucket (AWS S3, Supabase Storage, R2, MinIO) via
 *    real SigV4-signed HTTP — configured by the `EVIDENCE_S3_*` env vars.
 *
 * Both drivers implement the same interface and produce the same content-addressed,
 * wallet-namespaced `storageKey`, so switching backends is a config change with no
 * effect on the evidence pipeline or the stored DB pointers.
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
    case "s3": {
      const config = readS3StorageConfig(process.env);
      const credentials = readS3Credentials(process.env);
      singleton = new S3EvidenceStorage(config, credentials);
      return singleton;
    }
    default:
      throw new Error(
        `unknown EVIDENCE_STORAGE_DRIVER "${driver}" — supported: "local", "s3" (see LIMITATIONS.md §13)`,
      );
  }
}

/** Test seam: reset the memoized driver so a test can point at a temp dir. */
export function __resetEvidenceStorageForTests(): void {
  singleton = undefined;
}
