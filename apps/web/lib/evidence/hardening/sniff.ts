/**
 * Deep content sniffing for evidence uploads (LIMITATIONS §13, item 10).
 *
 * The MIME allowlist only ever saw a CLIENT-SUPPLIED label. This module looks at
 * the actual leading bytes and decides what the payload really is, then holds the
 * declared label to it. Two attacks close here:
 *
 *   1. **Type spoofing** — `payload.exe` uploaded as `image/png`. The declared type
 *      must agree with the sniffed type or the upload is refused (415).
 *   2. **Active content** — HTML/SVG/XHTML/scripts, which the `[id]` route already
 *      serves as `attachment` + `nosniff`; refusing them at the door means a stored
 *      XSS payload never reaches the blob store in the first place (defence in depth).
 *
 * Everything here is PURE (bytes in, verdict out) so it is exhaustively testable
 * with real file headers and no mocks.
 */
import { EvidenceContentRejectedError } from "../errors";

/** What a payload's bytes actually are, and how we treat that class of content. */
export type SniffedKind =
  | "image" // a raster image we can scrub metadata from
  | "image-unscrubbable" // a real image whose metadata we cannot strip (refused)
  | "document" // PDF
  | "text" // decodes as UTF-8 text with no active-content markers
  | "archive" // zip/gzip/7z/… — a container we cannot inspect (refused)
  | "executable" // ELF/PE/Mach-O/shebang (refused)
  | "active" // HTML/SVG/XML — scriptable content (refused)
  | "unknown"; // opaque bytes, no signature matched

export interface SniffedType {
  /** Canonical MIME type for the detected format ("application/octet-stream" when unknown). */
  readonly mimeType: string;
  readonly kind: SniffedKind;
  /** Short format label for logs/reports, e.g. "png", "elf", "html". */
  readonly label: string;
}

const ascii = (text: string): readonly number[] => Array.from(text, (c) => c.charCodeAt(0));

function at(bytes: Uint8Array, index: number): number | undefined {
  return bytes[index];
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (at(bytes, offset + i) !== signature[i]) return false;
  }
  return true;
}

/** Magic-number table, longest/most specific signatures first. */
const SIGNATURES: readonly {
  readonly sig: readonly number[];
  readonly offset?: number;
  readonly type: SniffedType;
}[] = [
  // --- images we can scrub -------------------------------------------------
  {
    sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    type: { mimeType: "image/png", kind: "image", label: "png" },
  },
  { sig: [0xff, 0xd8, 0xff], type: { mimeType: "image/jpeg", kind: "image", label: "jpeg" } },
  { sig: ascii("GIF87a"), type: { mimeType: "image/gif", kind: "image", label: "gif" } },
  { sig: ascii("GIF89a"), type: { mimeType: "image/gif", kind: "image", label: "gif" } },
  // --- images whose metadata we cannot strip (refused, see policy below) ----
  { sig: [0x49, 0x49, 0x2a, 0x00], type: mark("image/tiff", "tiff") },
  { sig: [0x4d, 0x4d, 0x00, 0x2a], type: mark("image/tiff", "tiff") },

  // --- documents -----------------------------------------------------------
  { sig: ascii("%PDF-"), type: { mimeType: "application/pdf", kind: "document", label: "pdf" } },

  // --- archives / compressed containers ------------------------------------
  { sig: [0x50, 0x4b, 0x03, 0x04], type: arch("application/zip", "zip") },
  { sig: [0x50, 0x4b, 0x05, 0x06], type: arch("application/zip", "zip") },
  { sig: [0x50, 0x4b, 0x07, 0x08], type: arch("application/zip", "zip") },
  { sig: [0x1f, 0x8b], type: arch("application/gzip", "gzip") },
  { sig: ascii("BZh"), type: arch("application/x-bzip2", "bzip2") },
  { sig: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], type: arch("application/x-xz", "xz") },
  { sig: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], type: arch("application/x-7z-compressed", "7z") },
  { sig: [...ascii("Rar!"), 0x1a, 0x07], type: arch("application/vnd.rar", "rar") },
  { sig: [0x75, 0x73, 0x74, 0x61, 0x72], offset: 257, type: arch("application/x-tar", "tar") },

  // --- executables ---------------------------------------------------------
  { sig: [0x7f, 0x45, 0x4c, 0x46], type: exe("application/x-elf", "elf") },
  { sig: ascii("MZ"), type: exe("application/x-msdownload", "pe") },
  { sig: [0xca, 0xfe, 0xba, 0xbe], type: exe("application/x-mach-binary", "mach-o-fat") },
  { sig: [0xcf, 0xfa, 0xed, 0xfe], type: exe("application/x-mach-binary", "mach-o") },
  { sig: [0xce, 0xfa, 0xed, 0xfe], type: exe("application/x-mach-binary", "mach-o") },
  { sig: [0xfe, 0xed, 0xfa, 0xcf], type: exe("application/x-mach-binary", "mach-o") },
  { sig: [0xfe, 0xed, 0xfa, 0xce], type: exe("application/x-mach-binary", "mach-o") },
  { sig: [0xd0, 0xcf, 0x11, 0xe0], type: exe("application/x-ole-storage", "ole") },
  { sig: ascii("#!"), type: exe("text/x-shellscript", "shebang") },
];

function mark(mimeType: string, label: string): SniffedType {
  return { mimeType, kind: "image-unscrubbable", label };
}
function arch(mimeType: string, label: string): SniffedType {
  return { mimeType, kind: "archive", label };
}
function exe(mimeType: string, label: string): SniffedType {
  return { mimeType, kind: "executable", label };
}

/** ISO-BMFF brands we detect via the `ftyp` box at offset 4 (HEIC/AVIF family). */
const FTYP_BRANDS: Record<string, SniffedType> = {
  avif: mark("image/avif", "avif"),
  avis: mark("image/avif", "avif"),
  heic: mark("image/heic", "heic"),
  heix: mark("image/heic", "heic"),
  hevc: mark("image/heic", "heic"),
  heim: mark("image/heic", "heic"),
  mif1: mark("image/heif", "heif"),
  msf1: mark("image/heif", "heif"),
};

/** Leading markers that make a text payload active content rather than data. */
const ACTIVE_MARKERS: readonly string[] = [
  "<!doctype html",
  "<html",
  "<head",
  "<body",
  "<script",
  "<iframe",
  "<svg",
  "<?xml",
  "<!entity",
  "<?php",
];

const HEAD_BYTES = 4096;

/** Decode the head of a payload as strict UTF-8, or null when it is not text. */
function decodeTextHead(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, Math.min(bytes.byteLength, HEAD_BYTES));
  let text: string;
  try {
    // `fatal` makes any invalid sequence throw → the payload is binary.
    text = new TextDecoder("utf-8", { fatal: true }).decode(head);
  } catch {
    return null;
  }
  // Control characters other than tab/newline/carriage-return/form-feed mean binary.
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d) {
      return null;
    }
  }
  return text;
}

/**
 * Identify a payload from its bytes alone. Never throws — the policy decision is
 * `assertSniffedContentAllowed` below, so callers can also sniff for reporting.
 */
export function sniffContent(bytes: Uint8Array): SniffedType {
  if (bytes.byteLength === 0) {
    return { mimeType: "application/octet-stream", kind: "unknown", label: "empty" };
  }

  // RIFF containers: WEBP (scrubbable) vs anything else (opaque).
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return { mimeType: "image/webp", kind: "image", label: "webp" };
  }

  // BMP: "BM" is only two bytes, so require the header's declared file size to
  // match the payload — otherwise a text file beginning "BM…" would sniff as BMP.
  if (startsWith(bytes, ascii("BM")) && bytes.byteLength >= 14) {
    const declaredSize =
      (at(bytes, 2) ?? 0) |
      ((at(bytes, 3) ?? 0) << 8) |
      ((at(bytes, 4) ?? 0) << 16) |
      ((at(bytes, 5) ?? 0) << 24);
    // BMP carries no standard metadata block, so it needs no scrubbing.
    if (declaredSize === bytes.byteLength) {
      return { mimeType: "image/bmp", kind: "image", label: "bmp" };
    }
  }

  // ISO-BMFF: `ftyp` box at offset 4, brand at offset 8.
  if (startsWith(bytes, ascii("ftyp"), 4) && bytes.byteLength >= 12) {
    const brand = new TextDecoder("latin1").decode(bytes.subarray(8, 12)).toLowerCase();
    const known = FTYP_BRANDS[brand];
    if (known) return known;
  }

  for (const entry of SIGNATURES) {
    if (startsWith(bytes, entry.sig, entry.offset ?? 0)) return entry.type;
  }

  const text = decodeTextHead(bytes);
  if (text !== null) {
    const head = text
      .trimStart()
      .toLowerCase()
      .replace(/^\uFEFF/, ""); // strip a UTF-8 BOM
    for (const marker of ACTIVE_MARKERS) {
      if (head.startsWith(marker)) {
        const isSvg = head.startsWith("<svg") || head.includes("<svg");
        return isSvg
          ? { mimeType: "image/svg+xml", kind: "active", label: "svg" }
          : {
              mimeType: marker === "<?xml" ? "application/xml" : "text/html",
              kind: "active",
              label: marker === "<?xml" ? "xml" : "html",
            };
      }
    }
    return { mimeType: "text/plain", kind: "text", label: "text" };
  }

  return { mimeType: "application/octet-stream", kind: "unknown", label: "binary" };
}

/** Normalise a declared MIME type: lowercase, drop parameters, fold known aliases. */
export function normaliseMime(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg";
  if (base === "image/x-png") return "image/png";
  if (base === "text/xml") return "application/xml";
  return base;
}

/** MIME types that mean "unlabelled bytes" rather than a claim about the format. */
const OPAQUE_MIMES = new Set(["application/octet-stream", "binary/octet-stream"]);

/** Declared text-ish types that a plain-UTF-8 payload legitimately satisfies. */
const TEXTUAL_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "application/ld+json",
]);

export interface SniffDecision {
  /** The corroborated type to store on the row (undefined only for unlabelled opaque bytes). */
  readonly effectiveMimeType: string | undefined;
  readonly sniffed: SniffedType;
}

/**
 * Hold a declared MIME type to the bytes, and refuse content classes we will not
 * store. Throws `EvidenceContentRejectedError` (→ 415) with a specific reason.
 *
 * Policy, in order:
 *  1. Executables, archives and active content are refused outright — no evidence
 *     workflow needs them, and each is a live attack surface.
 *  2. TIFF/HEIC/AVIF are refused because we cannot strip their embedded metadata:
 *     storing them would silently keep the GPS/camera EXIF this item exists to
 *     remove. Refusing is honest (rule 1); the uploader can convert to JPEG/PNG.
 *  3. A declared type must AGREE with the sniffed type. Unlabelled bytes
 *     (absent / octet-stream) adopt the sniffed type instead.
 *  4. Unknown binary with no declared type stays opaque `application/octet-stream`
 *     — the pre-existing behaviour, now the only path that is not corroborated
 *     (documented in LIMITATIONS §13).
 */
export function assertSniffedContentAllowed(input: {
  readonly bytes: Uint8Array;
  readonly declaredMimeType?: string | undefined;
}): SniffDecision {
  const sniffed = sniffContent(input.bytes);

  switch (sniffed.kind) {
    case "executable":
      throw new EvidenceContentRejectedError(
        `evidence content is an executable (${sniffed.label}); executables are not accepted`,
      );
    case "archive":
      throw new EvidenceContentRejectedError(
        `evidence content is an archive (${sniffed.label}); upload the files themselves instead`,
      );
    case "active":
      throw new EvidenceContentRejectedError(
        `evidence content is active/scriptable (${sniffed.label}); upload an image, PDF or plain text`,
      );
    case "image-unscrubbable":
      throw new EvidenceContentRejectedError(
        `evidence content is ${sniffed.label}, whose embedded metadata cannot be stripped; convert to JPEG or PNG first`,
      );
    default:
      break;
  }

  const declared =
    input.declaredMimeType === undefined ? undefined : normaliseMime(input.declaredMimeType);

  if (declared === undefined || declared.length === 0 || OPAQUE_MIMES.has(declared)) {
    // Unlabelled: adopt what the bytes actually are.
    return {
      effectiveMimeType: sniffed.kind === "unknown" ? undefined : sniffed.mimeType,
      sniffed,
    };
  }

  if (sniffed.kind === "text") {
    if (TEXTUAL_MIMES.has(declared) || declared.startsWith("text/")) {
      return { effectiveMimeType: declared, sniffed };
    }
    throw new EvidenceContentRejectedError(
      `evidence declared as ${declared} but its content is plain text`,
    );
  }

  if (sniffed.kind === "unknown") {
    throw new EvidenceContentRejectedError(
      `evidence declared as ${declared} but its content does not match that format`,
    );
  }

  if (declared !== sniffed.mimeType) {
    throw new EvidenceContentRejectedError(
      `evidence declared as ${declared} but its content is ${sniffed.mimeType}`,
    );
  }

  return { effectiveMimeType: sniffed.mimeType, sniffed };
}
