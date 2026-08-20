import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetEvidenceStorageForTests,
  getEvidenceStorage,
  LocalDiskEvidenceStorage,
  S3EvidenceStorage,
} from "./index";

/**
 * Always-on: the `getEvidenceStorage()` factory honours `EVIDENCE_STORAGE_DRIVER`.
 * Proves both drivers are wired and selectable by config alone (item 9) — and that an
 * unknown or misconfigured driver fails loudly rather than falling back silently.
 */

const S3_KEYS = [
  "EVIDENCE_STORAGE_DRIVER",
  "EVIDENCE_S3_BUCKET",
  "EVIDENCE_S3_REGION",
  "EVIDENCE_S3_ACCESS_KEY_ID",
  "EVIDENCE_S3_SECRET_ACCESS_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of S3_KEYS) saved[k] = process.env[k];
  __resetEvidenceStorageForTests();
});

afterEach(() => {
  for (const k of S3_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetEvidenceStorageForTests();
});

describe("getEvidenceStorage", () => {
  it("defaults to the local-disk driver when unset", () => {
    delete process.env["EVIDENCE_STORAGE_DRIVER"];
    expect(getEvidenceStorage()).toBeInstanceOf(LocalDiskEvidenceStorage);
  });

  it("selects the S3 driver by config alone", () => {
    process.env["EVIDENCE_STORAGE_DRIVER"] = "s3";
    process.env["EVIDENCE_S3_BUCKET"] = "commitai-evidence";
    process.env["EVIDENCE_S3_REGION"] = "us-east-1";
    process.env["EVIDENCE_S3_ACCESS_KEY_ID"] = "AKID";
    process.env["EVIDENCE_S3_SECRET_ACCESS_KEY"] = "secret";
    expect(getEvidenceStorage()).toBeInstanceOf(S3EvidenceStorage);
  });

  it("throws (no silent fallback) when the S3 driver is selected but unconfigured", () => {
    process.env["EVIDENCE_STORAGE_DRIVER"] = "s3";
    delete process.env["EVIDENCE_S3_BUCKET"];
    expect(() => getEvidenceStorage()).toThrow(/EVIDENCE_S3_BUCKET/);
  });

  it("throws on an unknown driver name", () => {
    process.env["EVIDENCE_STORAGE_DRIVER"] = "dropbox";
    expect(() => getEvidenceStorage()).toThrow(/unknown EVIDENCE_STORAGE_DRIVER/);
  });
});
