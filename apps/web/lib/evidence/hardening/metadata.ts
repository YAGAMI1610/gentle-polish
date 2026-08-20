/**
 * Image metadata scrubbing for evidence uploads (LIMITATIONS §13, item 10).
 *
 * A phone screenshot or photo carries EXIF: GPS coordinates, device serial, capture
 * time, sometimes a thumbnail of the ORIGINAL (unedited) frame. Evidence is stored
 * off-chain and its hash is anchorable on-chain, so whatever we keep is what the
 * user is committing to. We therefore strip metadata BEFORE hashing and storing —
 * `contentHash` is the digest of the scrubbed bytes that actually live in the store
 * (§13's anchorable-hash invariant stays true, now over sanitised bytes).
 *
 * The scrubbers are byte-level container rewrites — no image decoding, no re-encode,
 * so pixels are bit-identical and there is no quality loss:
 *
 *   - **JPEG**: drops APP1 (Exif/XMP), APP3-APP13 (incl. Photoshop IRB/IPTC), APP15
 *     and COM comments; keeps JFIF (APP0), ICC (APP2), Adobe (APP14) and every
 *     structural segment; drops anything appended after EOI.
 *   - **PNG**: keeps critical + rendering chunks by allowlist, dropping tEXt/zTXt/
 *     iTXt/eXIf/tIME and any private metadata chunk, plus data appended after IEND.
 *   - **WebP**: drops EXIF/XMP chunks, clears the matching VP8X flag bits, and
 *     rewrites the RIFF size so the container stays valid.
 *   - **GIF**: drops comment extensions and application extensions other than the
 *     NETSCAPE/ANIMEXTS loop block (which controls animation, not metadata).
 *   - **BMP**: no standard metadata block - returned unchanged.
 *
 * A container that does not parse is REFUSED (415) rather than stored: a malformed
 * image is either corrupt or an attempt to smuggle bytes past the parser.
 */
import { EvidenceContentRejectedError } from "../errors";

export interface MetadataScrubResult {
  /** Sanitised bytes - identical to the input when there was nothing to remove. */
  readonly bytes: Uint8Array;
  /** Labels of what was removed, e.g. `["jpeg:APP1(Exif)", "jpeg:COM"]`. */
  readonly removed: readonly string[];
}

function malformed(format: string, detail: string): never {
  throw new EvidenceContentRejectedError(`malformed ${format}: ${detail}`);
}

function u8(bytes: Uint8Array, index: number, format: string): number {
  const value = bytes[index];
  if (value === undefined) malformed(format, "truncated");
  return value;
}

function be16(bytes: Uint8Array, index: number, format: string): number {
  return (u8(bytes, index, format) << 8) | u8(bytes, index + 1, format);
}

function be32(bytes: Uint8Array, index: number, format: string): number {
  return (
    u8(bytes, index, format) * 0x1000000 +
    ((u8(bytes, index + 1, format) << 16) |
      (u8(bytes, index + 2, format) << 8) |
      u8(bytes, index + 3, format))
  );
}

function le32(bytes: Uint8Array, index: number, format: string): number {
  return (
    u8(bytes, index, format) +
    u8(bytes, index + 1, format) * 0x100 +
    u8(bytes, index + 2, format) * 0x10000 +
    u8(bytes, index + 3, format) * 0x1000000
  );
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

const latin1 = new TextDecoder("latin1");

/** Read the identifier string at the head of a segment payload (up to a NUL). */
function identifier(bytes: Uint8Array, start: number, end: number): string {
  const limit = Math.min(end, start + 32, bytes.byteLength);
  let stop = limit;
  for (let i = start; i < limit; i += 1) {
    if (bytes[i] === 0x00) {
      stop = i;
      break;
    }
  }
  return latin1.decode(bytes.subarray(start, stop));
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

/** APPn markers whose payload is metadata unless the identifier says otherwise. */
function keepJpegSegment(marker: number, id: string): boolean {
  switch (marker) {
    case 0xe0: // APP0 - JFIF/JFXX density + thumbnail structure
      return id.startsWith("JFIF") || id.startsWith("JFXX");
    case 0xe2: // APP2 - colour management, no personal data
      return id.startsWith("ICC_PROFILE");
    case 0xee: // APP14 - Adobe colour-transform flag; needed to decode CMYK/YCCK
      return id.startsWith("Adobe");
    case 0xfe: // COM - free-text comment
      return false;
    default:
      // Every other APPn (APP1 Exif/XMP, APP13 Photoshop IRB/IPTC, ...) is metadata.
      return !(marker >= 0xe1 && marker <= 0xef);
  }
}

function jpegSegmentLabel(marker: number, id: string): string {
  if (marker === 0xfe) return "jpeg:COM";
  const n = marker - 0xe0;
  const named = id.startsWith("Exif")
    ? "Exif"
    : id.startsWith("http://ns.adobe.com/xap")
      ? "XMP"
      : id.startsWith("Photoshop")
        ? "Photoshop"
        : id.length > 0
          ? id
          : "unnamed";
  return `jpeg:APP${n}(${named})`;
}

function scrubJpeg(bytes: Uint8Array): MetadataScrubResult {
  const F = "JPEG";
  if (!(u8(bytes, 0, F) === 0xff && u8(bytes, 1, F) === 0xd8)) malformed(F, "missing SOI");

  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed: string[] = [];
  let pos = 2;

  while (pos < bytes.byteLength) {
    if (u8(bytes, pos, F) !== 0xff) malformed(F, `expected a marker at offset ${pos}`);
    // 0xFF fill bytes may pad the gap before a marker; keep them with the segment.
    let markerIndex = pos + 1;
    while (u8(bytes, markerIndex, F) === 0xff) markerIndex += 1;
    const marker = u8(bytes, markerIndex, F);

    // Standalone markers (no length field).
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(pos, markerIndex + 1));
      pos = markerIndex + 1;
      continue;
    }

    if (marker === 0xd9) {
      // EOI ends the image; anything after it is appended payload, not image data.
      parts.push(bytes.subarray(pos, markerIndex + 1));
      if (markerIndex + 1 < bytes.byteLength) removed.push("jpeg:trailing-data");
      pos = bytes.byteLength;
      break;
    }

    const length = be16(bytes, markerIndex + 1, F);
    if (length < 2) malformed(F, `segment length ${length} at offset ${markerIndex}`);
    const segmentEnd = markerIndex + 1 + length;
    if (segmentEnd > bytes.byteLength) malformed(F, "segment runs past end of file");

    if (marker === 0xda) {
      // SOS: copy the header, then the entropy-coded scan up to the next real
      // marker. Inside the scan, 0xFF is stuffed as 0xFF00 and restart markers are
      // 0xFFD0-D7, so any other 0xFF-pair is the start of the next segment.
      parts.push(bytes.subarray(pos, segmentEnd));
      let scan = segmentEnd;
      while (scan < bytes.byteLength) {
        if (u8(bytes, scan, F) === 0xff) {
          const next = bytes[scan + 1];
          if (next === undefined) break;
          const stuffingOrRestart =
            next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7);
          if (!stuffingOrRestart) break;
        }
        scan += 1;
      }
      parts.push(bytes.subarray(segmentEnd, scan));
      pos = scan;
      continue;
    }

    const id = identifier(bytes, markerIndex + 3, segmentEnd);
    if (keepJpegSegment(marker, id)) {
      parts.push(bytes.subarray(pos, segmentEnd));
    } else {
      removed.push(jpegSegmentLabel(marker, id));
    }
    pos = segmentEnd;
  }

  return { bytes: removed.length === 0 ? bytes : concat(parts), removed };
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Chunks kept: the four critical ones plus the ancillary chunks that affect how the
 * image RENDERS. Everything else (tEXt/zTXt/iTXt/eXIf/tIME and any private chunk)
 * is metadata and is dropped.
 */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "iCCP",
  "bKGD",
  "pHYs",
  "sBIT",
  "sPLT",
  "hIST",
  "acTL", // APNG animation control
  "fcTL", // APNG frame control
  "fdAT", // APNG frame data
]);

function scrubPng(bytes: Uint8Array): MetadataScrubResult {
  const F = "PNG";
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (u8(bytes, i, F) !== PNG_SIGNATURE[i]) malformed(F, "bad signature");
  }

  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: string[] = [];
  let pos = 8;
  let sawIend = false;

  while (pos < bytes.byteLength) {
    const length = be32(bytes, pos, F);
    const type = latin1.decode(bytes.subarray(pos + 4, pos + 8));
    if (type.length < 4) malformed(F, "truncated chunk type");
    const chunkEnd = pos + 12 + length; // length + type + data + crc
    if (chunkEnd > bytes.byteLength) malformed(F, `chunk ${type} runs past end of file`);

    if (PNG_KEEP.has(type)) {
      parts.push(bytes.subarray(pos, chunkEnd));
    } else {
      removed.push(`png:${type}`);
    }

    pos = chunkEnd;
    if (type === "IEND") {
      sawIend = true;
      if (pos < bytes.byteLength) removed.push("png:trailing-data");
      break;
    }
  }

  if (!sawIend) malformed(F, "missing IEND");
  return { bytes: removed.length === 0 ? bytes : concat(parts), removed };
}

// ---------------------------------------------------------------------------
// WebP (RIFF)
// ---------------------------------------------------------------------------

/** VP8X feature-flag bits for the metadata chunks we remove. */
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

function scrubWebp(bytes: Uint8Array): MetadataScrubResult {
  const F = "WebP";
  if (latin1.decode(bytes.subarray(0, 4)) !== "RIFF") malformed(F, "missing RIFF header");
  if (latin1.decode(bytes.subarray(8, 12)) !== "WEBP") malformed(F, "missing WEBP form type");

  const kept: Uint8Array[] = [];
  const removed: string[] = [];
  let pos = 12;

  while (pos < bytes.byteLength) {
    const fourcc = latin1.decode(bytes.subarray(pos, pos + 4));
    if (fourcc.length < 4) malformed(F, "truncated chunk header");
    const size = le32(bytes, pos + 4, F);
    const padded = size + (size % 2); // RIFF chunks are padded to an even size
    const chunkEnd = pos + 8 + padded;
    if (pos + 8 + size > bytes.byteLength) malformed(F, `chunk ${fourcc} runs past end of file`);

    if (fourcc === "EXIF" || fourcc === "XMP ") {
      removed.push(`webp:${fourcc.trim()}`);
    } else if (fourcc === "VP8X") {
      // Clear the EXIF/XMP feature bits so the flags match the chunks we keep.
      const chunk = bytes.slice(pos, Math.min(chunkEnd, bytes.byteLength));
      const flags = u8(chunk, 8, F);
      const cleared = flags & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
      if (cleared !== flags) {
        chunk[8] = cleared;
        removed.push("webp:VP8X-flags");
      }
      kept.push(chunk);
    } else {
      kept.push(bytes.subarray(pos, Math.min(chunkEnd, bytes.byteLength)));
    }
    pos = chunkEnd;
  }

  if (removed.length === 0) return { bytes, removed };

  let payloadSize = 4; // the "WEBP" form type
  for (const chunk of kept) payloadSize += chunk.byteLength;
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 4), 0); // "RIFF"
  header[4] = payloadSize & 0xff;
  header[5] = (payloadSize >> 8) & 0xff;
  header[6] = (payloadSize >> 16) & 0xff;
  header[7] = (payloadSize >> 24) & 0xff;
  header.set(bytes.subarray(8, 12), 8); // "WEBP"
  return { bytes: concat([header, ...kept]), removed };
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

/** Application extensions that carry behaviour (loop count), not metadata. */
const GIF_KEEP_APP_IDS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

/** Walk GIF data sub-blocks from `pos`, returning the index just past the terminator. */
function gifSubBlocksEnd(bytes: Uint8Array, pos: number): number {
  const F = "GIF";
  let cursor = pos;
  for (;;) {
    const size = u8(bytes, cursor, F);
    cursor += 1;
    if (size === 0) return cursor;
    cursor += size;
    if (cursor > bytes.byteLength) malformed(F, "sub-block runs past end of file");
  }
}

function scrubGif(bytes: Uint8Array): MetadataScrubResult {
  const F = "GIF";
  const signature = latin1.decode(bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") malformed(F, "bad signature");

  const packed = u8(bytes, 10, F);
  let pos = 13;
  if ((packed & 0x80) !== 0) pos += 3 * 2 ** ((packed & 0x07) + 1); // global colour table
  if (pos > bytes.byteLength) malformed(F, "truncated logical screen descriptor");

  const parts: Uint8Array[] = [bytes.subarray(0, pos)];
  const removed: string[] = [];

  while (pos < bytes.byteLength) {
    const block = u8(bytes, pos, F);

    if (block === 0x3b) {
      parts.push(bytes.subarray(pos, pos + 1)); // trailer
      pos += 1;
      if (pos < bytes.byteLength) removed.push("gif:trailing-data");
      break;
    }

    if (block === 0x2c) {
      // Image descriptor -> optional local colour table -> LZW data sub-blocks.
      const imagePacked = u8(bytes, pos + 9, F);
      let cursor = pos + 10;
      if ((imagePacked & 0x80) !== 0) cursor += 3 * 2 ** ((imagePacked & 0x07) + 1);
      cursor += 1; // LZW minimum code size
      cursor = gifSubBlocksEnd(bytes, cursor);
      parts.push(bytes.subarray(pos, cursor));
      pos = cursor;
      continue;
    }

    if (block === 0x21) {
      const label = u8(bytes, pos + 1, F);
      const dataStart = pos + 2;
      const end = gifSubBlocksEnd(bytes, dataStart);

      if (label === 0xfe) {
        removed.push("gif:comment");
      } else if (label === 0xff) {
        const size = u8(bytes, dataStart, F);
        const appId = latin1.decode(bytes.subarray(dataStart + 1, dataStart + 1 + size));
        if (GIF_KEEP_APP_IDS.has(appId)) {
          parts.push(bytes.subarray(pos, end));
        } else {
          removed.push(`gif:application(${appId.trim() || "unnamed"})`);
        }
      } else {
        // Graphic control (0xF9) and plain-text (0x01) extensions affect rendering.
        parts.push(bytes.subarray(pos, end));
      }
      pos = end;
      continue;
    }

    malformed(F, `unknown block 0x${block.toString(16)} at offset ${pos}`);
  }

  return { bytes: removed.length === 0 ? bytes : concat(parts), removed };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Strip metadata from an image, keyed by the SNIFFED format label (never the
 * client's declared type - the sniffer has already corroborated the bytes).
 * Formats with no metadata container are returned unchanged, and the input array
 * is returned as-is when nothing was removed, so scrubbing is idempotent and
 * allocation-free in the common case.
 */
export function scrubImageMetadata(bytes: Uint8Array, sniffedLabel: string): MetadataScrubResult {
  switch (sniffedLabel) {
    case "jpeg":
      return scrubJpeg(bytes);
    case "png":
      return scrubPng(bytes);
    case "webp":
      return scrubWebp(bytes);
    case "gif":
      return scrubGif(bytes);
    default:
      return { bytes, removed: [] };
  }
}
