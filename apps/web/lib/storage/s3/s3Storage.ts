import type {
  EvidenceBlob,
  EvidencePutInput,
  EvidencePutResult,
  EvidenceStorage,
} from "../EvidenceStorage";
import type { S3Credentials, S3StorageConfig } from "./config";
import { amzDates, EMPTY_PAYLOAD_SHA256, sha256Hex, signRequest } from "./sigv4";

/**
 * S3-compatible `EvidenceStorage` driver (build-prompt §1 — "local disk OR an
 * S3-compatible bucket behind an EvidenceStorage interface"), implemented with real
 * SigV4-signed HTTP so it works against AWS S3, Supabase Storage's S3 endpoint,
 * Cloudflare R2, and MinIO with no SDK.
 *
 * Interchangeable with the local-disk driver: the logical `storageKey` is the same
 * content-addressed, wallet-namespaced `wallet/<addr>/<sha256>`, so the DB row is
 * driver-agnostic. Any configured key prefix is applied only when composing the
 * object URL, never leaked into the stored pointer. This is off-chain storage only
 * (§9): bytes never touch the chain, and the credential can move blobs, never funds
 * (rules 1/3).
 */

const KEY_PATTERN = /^wallet\/0x[0-9a-f]{40}\/[0-9a-f]{64}$/;
const SERVICE = "s3";

/** Minimal structural shape of the injected transport (the connectors DI idiom). */
export interface S3HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  readonly headers: { get(name: string): string | null };
}
export type S3Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<S3HttpResponse>;

const defaultFetch = fetch as unknown as S3Fetch;

export class S3EvidenceStorage implements EvidenceStorage {
  private readonly config: S3StorageConfig;
  private readonly credentials: S3Credentials;
  private readonly fetchFn: S3Fetch;
  private readonly now: () => Date;

  constructor(
    config: S3StorageConfig,
    credentials: S3Credentials,
    fetchFn: S3Fetch = defaultFetch,
    now: () => Date = () => new Date(),
  ) {
    this.config = config;
    this.credentials = credentials;
    this.fetchFn = fetchFn;
    this.now = now;
  }

  async put(input: EvidencePutInput): Promise<EvidencePutResult> {
    const addr = normalizeAddress(input.walletAddress);
    // Content hash doubles as the S3 payload hash (x-amz-content-sha256).
    const contentHash = sha256Hex(input.bytes);
    const storageKey = `wallet/${addr}/${contentHash}`;
    const sizeBytes = input.bytes.byteLength;

    const headers: Record<string, string> = {
      "x-amz-content-sha256": contentHash,
      "x-amz-meta-size": String(sizeBytes),
    };
    if (input.mimeType !== undefined) headers["content-type"] = input.mimeType;
    if (input.fileName !== undefined) {
      // Header values must be ASCII; encode to keep arbitrary filenames safe.
      headers["x-amz-meta-filename"] = encodeURIComponent(input.fileName);
    }

    const res = await this.send("PUT", storageKey, contentHash, headers, input.bytes);
    if (!res.ok) throw await storageError("put", storageKey, res);

    return { storageKey, contentHash, sizeBytes };
  }

  async get(storageKey: string): Promise<EvidenceBlob | null> {
    assertKey(storageKey);
    const res = await this.send("GET", storageKey, EMPTY_PAYLOAD_SHA256, {});
    if (res.status === 404) return null;
    if (!res.ok) throw await storageError("get", storageKey, res);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const mimeType = res.headers.get("content-type") ?? undefined;
    return mimeType !== undefined ? { bytes, mimeType } : { bytes };
  }

  async delete(storageKey: string): Promise<void> {
    assertKey(storageKey);
    const res = await this.send("DELETE", storageKey, EMPTY_PAYLOAD_SHA256, {});
    // S3 returns 204 whether or not the object existed, so delete is idempotent.
    // Tolerate a 404 from stricter gateways too.
    if (!res.ok && res.status !== 404) throw await storageError("delete", storageKey, res);
  }

  /** Compose the object URL, sign the request, and dispatch it via the transport. */
  private async send(
    method: string,
    storageKey: string,
    payloadHash: string,
    extraHeaders: Record<string, string>,
    body?: Uint8Array,
  ): Promise<S3HttpResponse> {
    const url = this.objectUrl(storageKey);
    const date = this.now();
    const { amzDate } = amzDates(date);
    // Assemble every header that must be signed BEFORE signing (SigV4 signs the
    // exact set we send: host, x-amz-date, x-amz-content-sha256, and any extras).
    const headers: Record<string, string> = {
      ...extraHeaders,
      host: new URL(url).host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    const { authorization } = signRequest({
      method,
      url,
      headers,
      payloadHash,
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      region: this.config.region,
      service: SERVICE,
      date,
    });
    const requestHeaders: Record<string, string> = { ...headers, authorization };

    return body !== undefined
      ? this.fetchFn(url, { method, headers: requestHeaders, body })
      : this.fetchFn(url, { method, headers: requestHeaders });
  }

  /** Build the full object URL for a logical key, applying prefix + addressing style. */
  private objectUrl(storageKey: string): string {
    const objectKey = this.config.prefix ? `${this.config.prefix}/${storageKey}` : storageKey;
    if (this.config.forcePathStyle) {
      // Preserve any path in the endpoint (e.g. Supabase's /storage/v1/s3).
      return `${this.config.endpoint}/${this.config.bucket}/${objectKey}`;
    }
    // Virtual-hosted: prepend the bucket to the endpoint host (AWS default).
    const base = new URL(this.config.endpoint);
    return `${base.protocol}//${this.config.bucket}.${base.host}/${objectKey}`;
  }
}

function assertKey(storageKey: string): void {
  if (!KEY_PATTERN.test(storageKey)) {
    throw new Error(`invalid evidence storage key: ${storageKey}`);
  }
}

function normalizeAddress(address: string): string {
  const addr = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    throw new Error("evidence storage requires a 0x-prefixed 40-hex wallet address");
  }
  return addr;
}

async function storageError(op: string, key: string, res: S3HttpResponse): Promise<Error> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // Body may be unreadable; the status is enough to act on.
  }
  return new Error(`S3 evidence ${op} failed (${res.status}) for ${key}: ${detail}`);
}
