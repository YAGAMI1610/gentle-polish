import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LocalDiskEvidenceStorage } from "./localDiskStorage";

/**
 * Local-disk `EvidenceStorage` driver — always-on tests against a real temp dir
 * (no mocks, no DB). These prove the off-chain blob boundary behaves: content
 * addressing, wallet namespacing, round-trip fidelity, idempotent delete, and the
 * path-traversal guard. All of build step 7's storage guarantees live or die here.
 */

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

let root: string;
let storage: LocalDiskEvidenceStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "commitai-store-"));
  storage = new LocalDiskEvidenceStorage(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalDiskEvidenceStorage", () => {
  it("round-trips bytes and metadata, returning a content-addressed key", async () => {
    const bytes = new TextEncoder().encode("hello evidence");
    const res = await storage.put({ walletAddress: A, bytes, mimeType: "text/plain" });

    expect(res.contentHash).toBe(sha256Hex(bytes));
    expect(res.sizeBytes).toBe(bytes.byteLength);
    // Key encodes ownership (wallet) and identity (hash) — nothing else.
    expect(res.storageKey).toBe(`wallet/${A}/${res.contentHash}`);

    const blob = await storage.get(res.storageKey);
    expect(blob).not.toBeNull();
    expect(Buffer.from(blob?.bytes ?? new Uint8Array()).toString("utf8")).toBe("hello evidence");
    expect(blob?.mimeType).toBe("text/plain");
  });

  it("is content-addressed: identical bytes dedupe, different bytes/wallets diverge", async () => {
    const bytes = new TextEncoder().encode("same bytes");
    const first = await storage.put({ walletAddress: A, bytes });
    const again = await storage.put({ walletAddress: A, bytes });
    expect(again.storageKey).toBe(first.storageKey);
    expect(again.contentHash).toBe(first.contentHash);

    // Different content → different key.
    const other = await storage.put({ walletAddress: A, bytes: new TextEncoder().encode("other") });
    expect(other.storageKey).not.toBe(first.storageKey);

    // Same content, different wallet → different key (namespaced, never shared).
    const bCopy = await storage.put({ walletAddress: B, bytes });
    expect(bCopy.contentHash).toBe(first.contentHash);
    expect(bCopy.storageKey).not.toBe(first.storageKey);
    expect(bCopy.storageKey.startsWith(`wallet/${B}/`)).toBe(true);
  });

  it("returns null for a well-formed but absent key", async () => {
    const absent = `wallet/${A}/${"0".repeat(64)}`;
    expect(await storage.get(absent)).toBeNull();
  });

  it("omits mimeType when none was stored, but still records size", async () => {
    const bytes = new TextEncoder().encode("no mime here");
    const res = await storage.put({ walletAddress: A, bytes });
    expect(res.sizeBytes).toBe(bytes.byteLength);

    const blob = await storage.get(res.storageKey);
    expect(blob).not.toBeNull();
    expect(blob?.mimeType).toBeUndefined();
  });

  it("delete removes the blob and is idempotent", async () => {
    const bytes = new TextEncoder().encode("delete me");
    const { storageKey } = await storage.put({ walletAddress: A, bytes });
    expect(await storage.get(storageKey)).not.toBeNull();

    await storage.delete(storageKey);
    expect(await storage.get(storageKey)).toBeNull();
    // Deleting a missing key is a no-op, not an error.
    await expect(storage.delete(storageKey)).resolves.toBeUndefined();
  });

  it("rejects malformed keys and any path-traversal attempt", async () => {
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(/invalid evidence storage key/);
    await expect(storage.get(`wallet/${A}/../../../../etc/passwd`)).rejects.toThrow(
      /invalid evidence storage key/,
    );
    // A key for the wrong shape (not 64-hex) is refused before touching disk.
    await expect(storage.get(`wallet/${A}/not-a-hash`)).rejects.toThrow(
      /invalid evidence storage key/,
    );
  });

  it("refuses a non-address wallet on put", async () => {
    await expect(
      storage.put({ walletAddress: "not-an-address", bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(/wallet address/);
  });
});
