import { describe, expect, it } from "vitest";
import { amzDates, EMPTY_PAYLOAD_SHA256, sha256Hex, signRequest, uriEncode } from "./sigv4";

/**
 * SigV4 correctness is the whole ballgame for the S3 driver: if the signature is
 * right, the driver authenticates against real S3 / Supabase / R2; if it's wrong,
 * nothing works. So the anchor test is AWS's OWN published "get-vanilla" test-suite
 * vector — a known request with a known, documented signature. Matching it
 * byte-for-byte proves this is the real algorithm, not an approximation (rule 1).
 * Reference: docs.aws.amazon.com/general/latest/gr/signature-v4-test-suite.html
 */

describe("amzDates", () => {
  it("splits a Date into the SigV4 timestamp and date stamp (UTC)", () => {
    expect(amzDates(new Date("2015-08-30T12:36:00.000Z"))).toEqual({
      amzDate: "20150830T123600Z",
      dateStamp: "20150830",
    });
    expect(amzDates(new Date("2026-01-02T03:04:05.678Z"))).toEqual({
      amzDate: "20260102T030405Z",
      dateStamp: "20260102",
    });
  });
});

describe("uriEncode", () => {
  it("passes unreserved characters through and percent-encodes the rest", () => {
    expect(uriEncode("AZaz09-._~")).toBe("AZaz09-._~");
    expect(uriEncode("a b")).toBe("a%20b");
    // encodeURIComponent leaves these alone; AWS requires them encoded.
    expect(uriEncode("!*'()")).toBe("%21%2A%27%28%29");
  });

  it("toggles slash encoding for path segments vs query values", () => {
    expect(uriEncode("a/b")).toBe("a%2Fb");
    expect(uriEncode("a/b", false)).toBe("a/b");
  });
});

describe("signRequest — AWS get-vanilla known-answer vector", () => {
  const result = signRequest({
    method: "GET",
    url: "https://example.amazonaws.com/",
    headers: { "x-amz-date": "20150830T123600Z" },
    payloadHash: EMPTY_PAYLOAD_SHA256,
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "service",
    date: new Date("2015-08-30T12:36:00.000Z"),
  });

  it("builds the exact canonical request AWS documents", () => {
    expect(result.canonicalRequest).toBe(
      [
        "GET",
        "/",
        "",
        "host:example.amazonaws.com",
        "x-amz-date:20150830T123600Z",
        "",
        "host;x-amz-date",
        EMPTY_PAYLOAD_SHA256,
      ].join("\n"),
    );
    // The published hash of that canonical request.
    expect(sha256Hex(result.canonicalRequest)).toBe(
      "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63",
    );
  });

  it("produces AWS's documented signature and Authorization header", () => {
    expect(result.signedHeaders).toBe("host;x-amz-date");
    expect(result.scope).toBe("20150830/us-east-1/service/aws4_request");
    expect(result.signature).toBe(
      "5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
    expect(result.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });
});

describe("signRequest — binds headers and payload", () => {
  const base = {
    method: "PUT",
    url: "https://bucket.s3.us-east-1.amazonaws.com/wallet/0xabc/hash",
    accessKeyId: "AKID",
    secretAccessKey: "secret",
    region: "us-east-1",
    service: "s3",
    date: new Date("2026-08-19T00:00:00.000Z"),
  };

  it("signs every provided header, sorted, and always includes host", () => {
    const r = signRequest({
      ...base,
      headers: {
        "x-amz-date": "20260819T000000Z",
        "x-amz-content-sha256": "abcd",
        "content-type": "image/png",
      },
      payloadHash: "abcd",
    });
    // Sorted, lowercased, host injected from the URL.
    expect(r.signedHeaders).toBe("content-type;host;x-amz-content-sha256;x-amz-date");
  });

  it("changes the signature when the payload hash changes (payload is bound)", () => {
    const mk = (payloadHash: string) =>
      signRequest({
        ...base,
        headers: { "x-amz-date": "20260819T000000Z", "x-amz-content-sha256": payloadHash },
        payloadHash,
      }).signature;
    expect(mk("aaaa")).not.toBe(mk("bbbb"));
  });
});
