import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { S3Credentials, S3StorageConfig } from "./config";
import { S3EvidenceStorage, type S3Fetch, type S3HttpResponse } from "./s3Storage";

/**
 * Always-on: the S3 driver's request shaping and response handling, with only the
 * network hop doubled (the connectors/onchainBackfill DI idiom). The signing itself
 * is proven real against AWS's vector in sigv4.test.ts; here we prove the driver
 * targets the right URL, sends a valid signed request, binds the content hash, keeps
 * the stored key free of any prefix, and maps S3 statuses to the interface contract.
 */

const A = "0x1111111111111111111111111111111111111111";
const CREDS: S3Credentials = { accessKeyId: "AKID", secretAccessKey: "secret" };
const CLOCK = () => new Date("2026-08-19T00:00:00.000Z");
const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const AWS_CFG: S3StorageConfig = {
  bucket: "commitai-evidence",
  region: "us-east-1",
  endpoint: "https://s3.us-east-1.amazonaws.com",
  forcePathStyle: false,
};
const PATH_CFG: S3StorageConfig = {
  bucket: "bkt",
  region: "us-east-1",
  endpoint: "https://proj.supabase.co/storage/v1/s3",
  forcePathStyle: true,
  prefix: "evidence",
};

function res(init: {
  ok?: boolean;
  status?: number;
  body?: Uint8Array;
  headers?: Record<string, string>;
}): S3HttpResponse {
  const copy = new Uint8Array(init.body ?? []);
  const headers = init.headers ?? {};
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    arrayBuffer: async () => copy.buffer,
    text: async () => "error body",
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  };
}

describe("S3EvidenceStorage.put", () => {
  it("PUTs a signed request to the virtual-hosted URL and binds the content hash", async () => {
    const bytes = new TextEncoder().encode("hello evidence");
    const hash = sha256Hex(bytes);
    const fetchFn = vi.fn<S3Fetch>(async () => res({ status: 200 }));
    const storage = new S3EvidenceStorage(AWS_CFG, CREDS, fetchFn, CLOCK);

    const out = await storage.put({
      walletAddress: A,
      bytes,
      mimeType: "text/plain",
      fileName: "n.txt",
    });

    // Interchangeable with the local driver: same content-addressed logical key.
    expect(out).toEqual({
      storageKey: `wallet/${A}/${hash}`,
      contentHash: hash,
      sizeBytes: bytes.byteLength,
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, req] = fetchFn.mock.calls[0]!;
    expect(req.method).toBe("PUT");
    expect(url).toBe(`https://commitai-evidence.s3.us-east-1.amazonaws.com/wallet/${A}/${hash}`);
    expect(req.body).toBe(bytes);
    // A real SigV4 Authorization header, with the payload hash bound as content-sha256.
    expect(req.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);
    expect(req.headers["x-amz-content-sha256"]).toBe(hash);
    expect(req.headers["x-amz-date"]).toBe("20260819T000000Z");
    expect(req.headers["content-type"]).toBe("text/plain");
    expect(req.headers["x-amz-meta-size"]).toBe(String(bytes.byteLength));
    expect(req.headers["x-amz-meta-filename"]).toBe("n.txt");
  });

  it("applies a configured prefix to the object URL but NOT to the stored key", async () => {
    const bytes = new TextEncoder().encode("x");
    const hash = sha256Hex(bytes);
    const fetchFn = vi.fn<S3Fetch>(async () => res({ status: 200 }));
    const storage = new S3EvidenceStorage(PATH_CFG, CREDS, fetchFn, CLOCK);

    const out = await storage.put({ walletAddress: A, bytes });

    expect(out.storageKey).toBe(`wallet/${A}/${hash}`); // prefix-free pointer
    const [url] = fetchFn.mock.calls[0]!;
    // Path-style: endpoint/bucket/prefix/key
    expect(url).toBe(`https://proj.supabase.co/storage/v1/s3/bkt/evidence/wallet/${A}/${hash}`);
  });

  it("throws on a non-2xx response and refuses a non-address wallet before any request", async () => {
    const fetchFn = vi.fn<S3Fetch>(async () => res({ ok: false, status: 403 }));
    const storage = new S3EvidenceStorage(AWS_CFG, CREDS, fetchFn, CLOCK);

    await expect(storage.put({ walletAddress: A, bytes: new Uint8Array([1]) })).rejects.toThrow(
      /403/,
    );

    await expect(
      storage.put({ walletAddress: "nope", bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/wallet address/);
    expect(fetchFn).toHaveBeenCalledOnce(); // the bad-wallet call never reached the network
  });
});

describe("S3EvidenceStorage.get", () => {
  const key = `wallet/${A}/${"a".repeat(64)}`;

  it("returns the bytes and content-type, and null on 404", async () => {
    const body = new TextEncoder().encode("blobdata");
    const okFetch = vi.fn<S3Fetch>(async () =>
      res({ status: 200, body, headers: { "content-type": "image/png" } }),
    );
    const storage = new S3EvidenceStorage(AWS_CFG, CREDS, okFetch, CLOCK);
    const blob = await storage.get(key);
    expect(Buffer.from(blob?.bytes ?? new Uint8Array()).toString("utf8")).toBe("blobdata");
    expect(blob?.mimeType).toBe("image/png");
    expect(okFetch.mock.calls[0]![1].method).toBe("GET");

    const missing = new S3EvidenceStorage(
      AWS_CFG,
      CREDS,
      async () => res({ ok: false, status: 404 }),
      CLOCK,
    );
    expect(await missing.get(key)).toBeNull();
  });

  it("throws on a non-404 error status", async () => {
    const storage = new S3EvidenceStorage(
      AWS_CFG,
      CREDS,
      async () => res({ ok: false, status: 500 }),
      CLOCK,
    );
    await expect(storage.get(key)).rejects.toThrow(/500/);
  });

  it("rejects a malformed key before touching the network", async () => {
    const fetchFn = vi.fn<S3Fetch>(async () => res({ status: 200 }));
    const storage = new S3EvidenceStorage(AWS_CFG, CREDS, fetchFn, CLOCK);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(/invalid evidence storage key/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("S3EvidenceStorage.delete", () => {
  const key = `wallet/${A}/${"b".repeat(64)}`;

  it("is idempotent: 204 and 404 both resolve, other errors throw", async () => {
    const del204 = new S3EvidenceStorage(AWS_CFG, CREDS, async () => res({ status: 204 }), CLOCK);
    await expect(del204.delete(key)).resolves.toBeUndefined();

    const del404 = new S3EvidenceStorage(
      AWS_CFG,
      CREDS,
      async () => res({ ok: false, status: 404 }),
      CLOCK,
    );
    await expect(del404.delete(key)).resolves.toBeUndefined();

    const del500 = new S3EvidenceStorage(
      AWS_CFG,
      CREDS,
      async () => res({ ok: false, status: 500 }),
      CLOCK,
    );
    await expect(del500.delete(key)).rejects.toThrow(/500/);
  });
});
