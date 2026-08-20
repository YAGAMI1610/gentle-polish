import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 — the real S3 request-signing algorithm (no SDK).
 *
 * This is the actual protocol AWS S3, Supabase Storage's S3 endpoint, Cloudflare
 * R2, and MinIO all authenticate with, implemented over `node:crypto` so the
 * evidence-storage S3 driver needs zero extra dependencies. It is intentionally
 * pure: `signRequest` takes the request + credentials + a caller-supplied clock and
 * returns the `Authorization` header plus every intermediate value, so a
 * known-answer test can pin it against AWS's own published SigV4 test vector.
 *
 * Reference: docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const AWS4_REQUEST = "aws4_request";

/** sha256 of an empty body — the payload hash for GET/DELETE and empty PUTs. */
export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Split a `Date` into the two UTC forms SigV4 needs: the basic-format timestamp
 * `YYYYMMDDTHHMMSSZ` and the `YYYYMMDD` date stamp used in the credential scope.
 */
export function amzDates(date: Date): { amzDate: string; dateStamp: string } {
  // toISOString() → 2015-08-30T12:36:00.000Z; strip separators and the millis.
  const amzDate = date
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}/, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * RFC 3986 percent-encoding as AWS requires: only `A-Za-z0-9-._~` pass through
 * unescaped (unlike `encodeURIComponent`, which also leaves `!*'()`). Slashes are
 * escaped in query values but preserved in path segments (`encodeSlash=false`).
 */
export function uriEncode(input: string, encodeSlash = true): string {
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x2e || // .
      byte === 0x5f || // _
      byte === 0x7e; // ~
    if (isUnreserved) {
      out += String.fromCharCode(byte);
    } else if (byte === 0x2f /* / */ && !encodeSlash) {
      out += "/";
    } else {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/** Canonical URI: each path segment single-encoded (S3 rule), slashes preserved. */
function canonicalUri(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => uriEncode(seg, true))
    .join("/");
}

/** Canonical query string: params sorted by key, key and value URI-encoded. */
function canonicalQuery(search: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [k, v] of search) pairs.push([uriEncode(k), uriEncode(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

export interface SignInput {
  readonly method: string;
  readonly url: string | URL;
  /** Headers to sign. `host` is derived from the URL when absent. */
  readonly headers: Record<string, string>;
  /** Hex sha256 of the request body (`EMPTY_PAYLOAD_SHA256` for none). */
  readonly payloadHash: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service: string;
  readonly date: Date;
}

export interface SignResult {
  /** The finished `Authorization` header value. */
  readonly authorization: string;
  readonly amzDate: string;
  readonly signedHeaders: string;
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly signature: string;
  readonly scope: string;
}

/**
 * Produce the SigV4 `Authorization` header (and every intermediate value) for a
 * request. Exactly the headers passed in `headers` — plus a derived `host` — are
 * signed, so a test can reproduce AWS's canonical test vectors byte-for-byte.
 */
export function signRequest(input: SignInput): SignResult {
  const url = typeof input.url === "string" ? new URL(input.url) : input.url;
  const { amzDate, dateStamp } = amzDates(input.date);

  // Normalize headers: lowercase names, collapse internal whitespace in values,
  // ensure `host` is present (SigV4 always signs it).
  const normalized = new Map<string, string>();
  for (const [k, v] of Object.entries(input.headers)) {
    normalized.set(k.toLowerCase(), v.trim().replace(/\s+/g, " "));
  }
  if (!normalized.has("host")) normalized.set("host", url.host);

  const sorted = [...normalized.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders = sorted.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = sorted.map(([k]) => k).join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/${AWS4_REQUEST}`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, AWS4_REQUEST);
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    amzDate,
    signedHeaders,
    canonicalRequest,
    stringToSign,
    signature,
    scope,
  };
}
