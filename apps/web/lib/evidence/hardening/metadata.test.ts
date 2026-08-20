import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EvidenceContentRejectedError } from "../errors";
import { scrubImageMetadata } from "./metadata";

/**
 * Metadata-scrubbing tests (LIMITATIONS §13, item 10). No mocks and no synthetic
 * "pretend" images where a real one exists: the JPEG and PNG cases operate on the
 * actual files shipped in `public/assets` (each of which really does carry an
 * XMP/iTXt metadata block), and the GIF/WebP cases use the canonical 1×1 files
 * decoded from their well-known base64. Metadata blocks are then INSERTED into those
 * real files with real container framing (real CRC32s for PNG) and the scrubber has
 * to bring the file back to a byte-for-byte match with the metadata-free version.
 */

const asset = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), "public", "assets", name)));

const REAL_GIF = new Uint8Array(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
);
const REAL_WEBP = new Uint8Array(
  Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64"),
);

const ascii = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "latin1"));
const join_ = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
};

/** Index of `needle` in `haystack`, or -1. Used to assert metadata is really gone. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.byteLength <= haystack.byteLength; i += 1) {
    for (let j = 0; j < needle.byteLength; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// --- JPEG helpers ----------------------------------------------------------

/** A JPEG APPn/COM segment: FF <marker> <BE length incl. the 2 length bytes> <payload>. */
function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.byteLength + 2;
  return join_(new Uint8Array([0xff, marker, (length >> 8) & 0xff, length & 0xff]), payload);
}

/**
 * A real (little-endian TIFF) EXIF APP1 payload carrying a GPS IFD, the exact class
 * of metadata this item exists to remove.
 */
function exifApp1Payload(): Uint8Array {
  const tiff = new Uint8Array(38);
  const view = new DataView(tiff.buffer);
  tiff.set(ascii("II"), 0); // little-endian
  view.setUint16(2, 0x2a, true); // TIFF magic
  view.setUint32(4, 8, true); // offset of IFD0
  view.setUint16(8, 1, true); // IFD0: one entry
  view.setUint16(10, 0x8825, true); // GPSInfo IFD pointer
  view.setUint16(12, 4, true); // type LONG
  view.setUint32(14, 1, true); // count
  view.setUint32(18, 26, true); // value: offset of the GPS IFD
  view.setUint32(22, 0, true); // no IFD1
  view.setUint16(26, 1, true); // GPS IFD: one entry
  view.setUint16(28, 0x0001, true); // GPSLatitudeRef
  view.setUint16(30, 2, true); // type ASCII
  view.setUint32(32, 2, true); // count
  tiff.set(ascii("N\0"), 36); // inline value
  return join_(ascii("Exif\0\0"), tiff);
}

/** Insert segments straight after SOI, where a camera/editor would write them. */
function insertAfterSoi(jpeg: Uint8Array, ...segments: Uint8Array[]): Uint8Array {
  return join_(jpeg.subarray(0, 2), ...segments, jpeg.subarray(2));
}

/** Offset of the SOS marker, i.e. where entropy-coded pixel data begins. */
function sosOffset(jpeg: Uint8Array): number {
  return indexOfBytes(jpeg, new Uint8Array([0xff, 0xda]));
}

// --- PNG helpers -----------------------------------------------------------

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const body = join_(typeBytes, data);
  const out = new Uint8Array(12 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.byteLength);
  out.set(body, 4);
  view.setUint32(8 + data.byteLength, crc32(Buffer.from(body)) >>> 0);
  return out;
}

/** Walk a PNG, returning [type, dataLength, crcValid] for every chunk. */
function pngChunks(png: Uint8Array): { type: string; length: number; crcOk: boolean }[] {
  const out: { type: string; length: number; crcOk: boolean }[] = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos + 12 <= png.byteLength) {
    const length = view.getUint32(pos);
    const type = Buffer.from(png.subarray(pos + 4, pos + 8)).toString("latin1");
    const body = png.subarray(pos + 4, pos + 8 + length);
    const stored = view.getUint32(pos + 8 + length);
    out.push({ type, length, crcOk: crc32(Buffer.from(body)) >>> 0 === stored });
    pos += 12 + length;
    if (type === "IEND") break;
  }
  return out;
}

function insertPngChunksBeforeIdat(png: Uint8Array, ...chunks: Uint8Array[]): Uint8Array {
  const idat = indexOfBytes(png, ascii("IDAT")) - 4; // back up over the length field
  return join_(png.subarray(0, idat), ...chunks, png.subarray(idat));
}

// --- RIFF/WebP helpers -----------------------------------------------------

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const size = data.byteLength;
  const header = new Uint8Array(8);
  header.set(ascii(fourcc), 0);
  new DataView(header.buffer).setUint32(4, size, true);
  const pad = size % 2 === 1 ? new Uint8Array(1) : new Uint8Array(0);
  return join_(header, data, pad);
}

function riffChunks(webp: Uint8Array): { fourcc: string; size: number }[] {
  const out: { fourcc: string; size: number }[] = [];
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  let pos = 12;
  while (pos + 8 <= webp.byteLength) {
    const fourcc = Buffer.from(webp.subarray(pos, pos + 4)).toString("latin1");
    const size = view.getUint32(pos + 4, true);
    out.push({ fourcc, size });
    pos += 8 + size + (size % 2);
  }
  return out;
}

// --- GIF helpers -----------------------------------------------------------

/** A GIF extension block: 0x21 <label> then length-prefixed sub-blocks, then 0x00. */
function gifExtension(label: number, payload: Uint8Array): Uint8Array {
  return join_(new Uint8Array([0x21, label, payload.byteLength]), payload, new Uint8Array([0x00]));
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

describe("scrubImageMetadata — JPEG (real file from public/assets)", () => {
  const original = asset("hero-topo.jpg");

  it("removes the XMP APP1 block the real file ships with, keeping JFIF and the scan", () => {
    const result = scrubImageMetadata(original, "jpeg");
    expect(result.removed).toEqual(["jpeg:APP1(XMP)"]);
    expect(result.bytes.byteLength).toBeLessThan(original.byteLength);
    // JFIF (APP0) survives; the XMP identifier is gone from the file entirely.
    expect(indexOfBytes(result.bytes, ascii("JFIF"))).toBeGreaterThan(0);
    expect(indexOfBytes(result.bytes, ascii("http://ns.adobe.com/xap"))).toBe(-1);
    // Pixels are untouched: every byte from SOS to EOF is bit-identical.
    const from = sosOffset(original);
    const to = sosOffset(result.bytes);
    expect(
      Buffer.compare(Buffer.from(result.bytes.subarray(to)), Buffer.from(original.subarray(from))),
    ).toBe(0);
  });

  it("removes an inserted EXIF/GPS block and a comment, landing on the same bytes", () => {
    const baseline = scrubImageMetadata(original, "jpeg").bytes;
    const withMetadata = insertAfterSoi(
      original,
      jpegSegment(0xe1, exifApp1Payload()), // APP1 Exif with a GPS IFD
      jpegSegment(0xfe, ascii("shot at 51.5074,-0.1278")), // COM comment
      jpegSegment(0xed, ascii("Photoshop 3.0\0IPTC")), // APP13 Photoshop/IPTC
    );

    const result = scrubImageMetadata(withMetadata, "jpeg");
    expect(result.removed).toEqual([
      "jpeg:APP1(Exif)",
      "jpeg:COM",
      "jpeg:APP13(Photoshop)",
      "jpeg:APP1(XMP)",
    ]);
    // Known-answer: the scrubbed file equals the metadata-free original, byte for byte.
    expect(Buffer.compare(Buffer.from(result.bytes), Buffer.from(baseline))).toBe(0);
    expect(indexOfBytes(result.bytes, ascii("Exif\0\0"))).toBe(-1);
    expect(indexOfBytes(result.bytes, ascii("51.5074"))).toBe(-1);
  });

  it("keeps an ICC profile (colour fidelity, not personal data)", () => {
    const withIcc = insertAfterSoi(original, jpegSegment(0xe2, ascii("ICC_PROFILE\0\0\x01")));
    const result = scrubImageMetadata(withIcc, "jpeg");
    expect(result.removed).not.toContain("jpeg:APP2(ICC_PROFILE)");
    expect(indexOfBytes(result.bytes, ascii("ICC_PROFILE"))).toBeGreaterThan(0);
  });

  it("drops data appended after EOI and is idempotent", () => {
    const smuggled = join_(original, ascii("<?php system($_GET['c']); ?>"));
    const result = scrubImageMetadata(smuggled, "jpeg");
    expect(result.removed).toContain("jpeg:trailing-data");
    expect(indexOfBytes(result.bytes, ascii("<?php"))).toBe(-1);

    const again = scrubImageMetadata(result.bytes, "jpeg");
    expect(again.removed).toEqual([]);
    expect(again.bytes).toBe(result.bytes); // same array: nothing to do
  });

  it("refuses a malformed JPEG rather than storing it", () => {
    expect(() => scrubImageMetadata(ascii("\xff\xd8not-a-jpeg-body"), "jpeg")).toThrow(
      EvidenceContentRejectedError,
    );
    expect(() => scrubImageMetadata(ascii("\xff\xd8\xff\xe1\x00"), "jpeg")).toThrow(
      /malformed JPEG/,
    );
  });
});

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

describe("scrubImageMetadata — PNG (real file from public/assets)", () => {
  const original = asset("agent-mark.png");

  it("removes the iTXt block the real file ships with, keeping every critical chunk", () => {
    const before = pngChunks(original).map((c) => c.type);
    expect(before).toContain("iTXt");

    const result = scrubImageMetadata(original, "png");
    expect(result.removed).toEqual(["png:iTXt"]);

    const after = pngChunks(result.bytes);
    expect(after.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IDAT", "IEND"]);
    // Every surviving chunk still has a valid CRC — the rewrite corrupted nothing.
    expect(after.every((c) => c.crcOk)).toBe(true);
  });

  it("removes inserted tEXt/eXIf/tIME chunks, landing on the same bytes", () => {
    const baseline = scrubImageMetadata(original, "png").bytes;
    const withMetadata = insertPngChunksBeforeIdat(
      original,
      pngChunk("tEXt", ascii("Comment\0taken at 51.5074,-0.1278")),
      pngChunk("eXIf", exifApp1Payload().subarray(6)), // the TIFF/EXIF block itself
      pngChunk("tIME", new Uint8Array([0x07, 0xea, 8, 19, 12, 0, 0])),
    );

    const result = scrubImageMetadata(withMetadata, "png");
    // Order follows the file: the real iTXt sits before the insertion point.
    expect(result.removed).toEqual(["png:iTXt", "png:tEXt", "png:eXIf", "png:tIME"]);
    expect(Buffer.compare(Buffer.from(result.bytes), Buffer.from(baseline))).toBe(0);
    expect(indexOfBytes(result.bytes, ascii("51.5074"))).toBe(-1);
  });

  it("drops data appended after IEND and is idempotent", () => {
    const smuggled = join_(original, ascii("PK\x03\x04payload"));
    const result = scrubImageMetadata(smuggled, "png");
    expect(result.removed).toContain("png:trailing-data");
    expect(indexOfBytes(result.bytes, ascii("payload"))).toBe(-1);
    expect(scrubImageMetadata(result.bytes, "png").removed).toEqual([]);
  });

  it("refuses a malformed PNG rather than storing it", () => {
    expect(() => scrubImageMetadata(ascii("not-a-png-at-all"), "png")).toThrow(/bad signature/);
    // Signature + IHDR but no IEND.
    const truncated = original.subarray(0, 8 + 25);
    expect(() => scrubImageMetadata(truncated, "png")).toThrow(/malformed PNG/);
  });
});

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

describe("scrubImageMetadata — WebP", () => {
  it("leaves the canonical 1x1 WebP untouched (nothing to remove)", () => {
    const result = scrubImageMetadata(REAL_WEBP, "webp");
    expect(result.removed).toEqual([]);
    expect(result.bytes).toBe(REAL_WEBP);
  });

  it("removes EXIF/XMP chunks, clears the VP8X flags and rewrites the RIFF size", () => {
    // Extended-format WebP: VP8X (with the EXIF+XMP feature bits set) + the real
    // 1x1 VP8 bitstream + the two metadata chunks a camera/editor would append.
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x08 | 0x04; // EXIF + XMP flags
    vp8x[4] = 0x00; // canvas width - 1 (24-bit LE) => 1px
    vp8x[7] = 0x00; // canvas height - 1 => 1px
    const vp8Payload = REAL_WEBP.subarray(20); // the VP8 chunk's data from the real file
    const extended = join_(
      ascii("RIFF"),
      new Uint8Array(4), // size patched below
      ascii("WEBP"),
      riffChunk("VP8X", vp8x),
      riffChunk("VP8 ", vp8Payload),
      riffChunk("EXIF", exifApp1Payload().subarray(6)),
      riffChunk("XMP ", ascii("<x:xmpmeta><gps>51.5074,-0.1278</gps></x:xmpmeta>")),
    );
    new DataView(extended.buffer).setUint32(4, extended.byteLength - 8, true);

    const result = scrubImageMetadata(extended, "webp");
    expect(result.removed).toEqual(["webp:VP8X-flags", "webp:EXIF", "webp:XMP"]);

    const chunks = riffChunks(result.bytes);
    expect(chunks.map((c) => c.fourcc)).toEqual(["VP8X", "VP8 "]);
    // The rewritten RIFF size matches the real payload length, so the file stays valid.
    const declared = new DataView(
      result.bytes.buffer,
      result.bytes.byteOffset,
      result.bytes.byteLength,
    ).getUint32(4, true);
    expect(declared).toBe(result.bytes.byteLength - 8);
    // The VP8X feature bits no longer advertise metadata that is gone.
    expect(result.bytes[20]).toBe(0);
    expect(indexOfBytes(result.bytes, ascii("51.5074"))).toBe(-1);
    // Idempotent.
    expect(scrubImageMetadata(result.bytes, "webp").removed).toEqual([]);
  });

  it("refuses a malformed RIFF container", () => {
    expect(() => scrubImageMetadata(ascii("RIFF____NOPE"), "webp")).toThrow(/missing WEBP/);
    expect(() => scrubImageMetadata(ascii("nope"), "webp")).toThrow(/missing RIFF/);
  });
});

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

describe("scrubImageMetadata — GIF", () => {
  it("leaves the canonical 1x1 GIF untouched (nothing to remove)", () => {
    const result = scrubImageMetadata(REAL_GIF, "gif");
    expect(result.removed).toEqual([]);
    expect(result.bytes).toBe(REAL_GIF);
  });

  it("removes comment and metadata application extensions but keeps the loop block", () => {
    // Splice extensions in after the logical screen descriptor + global colour table
    // of the real 1x1 GIF (13 + 3*2 bytes for its 2-entry table).
    const headerEnd = 13 + 6;
    const netscape = join_(
      new Uint8Array([0x21, 0xff, 11]),
      ascii("NETSCAPE2.0"),
      new Uint8Array([3, 1, 0, 0, 0]),
    );
    const withMetadata = join_(
      REAL_GIF.subarray(0, headerEnd),
      gifExtension(0xfe, ascii("captured at 51.5074,-0.1278")),
      join_(new Uint8Array([0x21, 0xff, 11]), ascii("XMP DataXMP"), new Uint8Array([0x00])),
      netscape,
      REAL_GIF.subarray(headerEnd),
    );

    const result = scrubImageMetadata(withMetadata, "gif");
    expect(result.removed).toEqual(["gif:comment", "gif:application(XMP DataXMP)"]);
    expect(indexOfBytes(result.bytes, ascii("51.5074"))).toBe(-1);
    expect(indexOfBytes(result.bytes, ascii("NETSCAPE2.0"))).toBeGreaterThan(0);
    // What remains is the real GIF plus the loop block, and it still ends with the trailer.
    expect(result.bytes[result.bytes.byteLength - 1]).toBe(0x3b);
    expect(result.bytes.byteLength).toBe(REAL_GIF.byteLength + netscape.byteLength);
    expect(scrubImageMetadata(result.bytes, "gif").removed).toEqual([]);
  });

  it("refuses a malformed GIF", () => {
    expect(() => scrubImageMetadata(ascii("GIF89xBROKEN"), "gif")).toThrow(/bad signature/);
  });
});

describe("scrubImageMetadata — formats with no metadata container", () => {
  it("returns BMP and unknown formats unchanged", () => {
    const bmp = new Uint8Array([0x42, 0x4d, 1, 2, 3]);
    expect(scrubImageMetadata(bmp, "bmp")).toEqual({ bytes: bmp, removed: [] });
    const opaque = new Uint8Array([1, 2, 3]);
    expect(scrubImageMetadata(opaque, "binary")).toEqual({ bytes: opaque, removed: [] });
  });
});
