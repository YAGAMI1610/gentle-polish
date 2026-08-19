import { describe, expect, it } from "vitest";
import { readS3Credentials, readS3StorageConfig } from "./config";

/**
 * Always-on: the S3 config follows the same honesty contract as chain/config —
 * when the driver is selected every required value must resolve or we throw loudly
 * (never a silent fallback), and the secret is read by a separate function so it
 * can't ride inside a loggable config object.
 */

const FULL = {
  EVIDENCE_S3_BUCKET: "commitai-evidence",
  EVIDENCE_S3_REGION: "us-east-1",
  EVIDENCE_S3_ACCESS_KEY_ID: "AKIA_TEST",
  EVIDENCE_S3_SECRET_ACCESS_KEY: "s3cr3t",
};

describe("readS3StorageConfig", () => {
  it("throws with the offending var name when a required value is missing", () => {
    expect(() => readS3StorageConfig({})).toThrow(/EVIDENCE_S3_BUCKET/);
    expect(() => readS3StorageConfig({ EVIDENCE_S3_BUCKET: "b" })).toThrow(/EVIDENCE_S3_REGION/);
  });

  it("derives the AWS regional endpoint and virtual-hosted addressing by default", () => {
    const cfg = readS3StorageConfig(FULL);
    expect(cfg.endpoint).toBe("https://s3.us-east-1.amazonaws.com");
    expect(cfg.forcePathStyle).toBe(false); // AWS default = virtual-hosted
    expect(cfg.prefix).toBeUndefined();
  });

  it("uses a custom endpoint (Supabase/R2/MinIO) with path-style addressing by default", () => {
    const cfg = readS3StorageConfig({
      ...FULL,
      EVIDENCE_S3_ENDPOINT: "https://proj.supabase.co/storage/v1/s3/",
      EVIDENCE_S3_PREFIX: "/evidence/",
    });
    expect(cfg.endpoint).toBe("https://proj.supabase.co/storage/v1/s3"); // trailing slash trimmed
    expect(cfg.forcePathStyle).toBe(true); // custom endpoint → path-style
    expect(cfg.prefix).toBe("evidence"); // surrounding slashes trimmed
  });

  it("honours an explicit EVIDENCE_S3_FORCE_PATH_STYLE override", () => {
    expect(
      readS3StorageConfig({ ...FULL, EVIDENCE_S3_FORCE_PATH_STYLE: "true" }).forcePathStyle,
    ).toBe(true);
    expect(
      readS3StorageConfig({
        ...FULL,
        EVIDENCE_S3_ENDPOINT: "https://custom.example",
        EVIDENCE_S3_FORCE_PATH_STYLE: "false",
      }).forcePathStyle,
    ).toBe(false);
  });

  it("throws when the endpoint is not a valid URL", () => {
    expect(() => readS3StorageConfig({ ...FULL, EVIDENCE_S3_ENDPOINT: "not a url" })).toThrow(
      /EVIDENCE_S3_ENDPOINT/,
    );
  });
});

describe("readS3Credentials", () => {
  it("reads the key pair separately from the config object", () => {
    expect(readS3Credentials(FULL)).toEqual({
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "s3cr3t",
    });
  });

  it("throws when either half is missing", () => {
    expect(() => readS3Credentials({ EVIDENCE_S3_ACCESS_KEY_ID: "AKIA" })).toThrow(
      /EVIDENCE_S3_SECRET_ACCESS_KEY/,
    );
    expect(() => readS3Credentials({ EVIDENCE_S3_SECRET_ACCESS_KEY: "s" })).toThrow(
      /EVIDENCE_S3_ACCESS_KEY_ID/,
    );
  });
});
