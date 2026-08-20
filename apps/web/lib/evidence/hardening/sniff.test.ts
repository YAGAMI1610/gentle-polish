import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceContentRejectedError } from "../errors";
import { assertSniffedContentAllowed, normaliseMime, sniffContent } from "./sniff";

/**
 * Sniffer tests (LIMITATIONS §13, item 10). Always-on, no mocks: the image cases use
 * REAL files — two shipped in `public/assets`, plus the two canonical 1×1 GIF/WebP
 * files decoded from their well-known base64 — and every other case uses the actual
 * magic bytes from the format's specification. The point is that the declared MIME
 * type can no longer lie: bytes decide.
 */

const asset = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), "public", "assets", name)));

/** The real 1×1 transparent GIF89a (43 bytes) and 1×1 lossy WebP (26 bytes). */
const REAL_GIF = new Uint8Array(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
);
const REAL_WEBP = new Uint8Array(
  Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64"),
);

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("sniffContent — real images", () => {
  it("identifies a real PNG shipped in this repo", () => {
    expect(sniffContent(asset("agent-mark.png"))).toEqual({
      mimeType: "image/png",
      kind: "image",
      label: "png",
    });
  });

  it("identifies a real JPEG shipped in this repo", () => {
    expect(sniffContent(asset("hero-topo.jpg"))).toEqual({
      mimeType: "image/jpeg",
      kind: "image",
      label: "jpeg",
    });
  });

  it("identifies the canonical 1x1 GIF and WebP", () => {
    expect(sniffContent(REAL_GIF).mimeType).toBe("image/gif");
    expect(sniffContent(REAL_WEBP).mimeType).toBe("image/webp");
  });

  it("identifies a BMP only when the header's size field matches the payload", () => {
    const bmp = new Uint8Array(14);
    bmp[0] = 0x42; // "B"
    bmp[1] = 0x4d; // "M"
    new DataView(bmp.buffer).setUint32(2, bmp.byteLength, true);
    expect(sniffContent(bmp).mimeType).toBe("image/bmp");
    // A text file that merely starts with "BM" must not be mistaken for a bitmap.
    expect(sniffContent(text("BMW service receipt, 14 Aug 2026")).kind).toBe("text");
  });
});

describe("sniffContent — refused content classes", () => {
  it("detects executables", () => {
    expect(sniffContent(bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0)).kind).toBe("executable"); // ELF
    expect(sniffContent(text("MZ\x90\x00\x03")).kind).toBe("executable"); // PE/DOS
    expect(sniffContent(bytes(0xcf, 0xfa, 0xed, 0xfe, 7)).kind).toBe("executable"); // Mach-O
    expect(sniffContent(text("#!/bin/sh\nrm -rf /\n")).kind).toBe("executable"); // script
  });

  it("detects archives", () => {
    expect(sniffContent(bytes(0x50, 0x4b, 0x03, 0x04)).mimeType).toBe("application/zip");
    expect(sniffContent(bytes(0x1f, 0x8b, 0x08)).mimeType).toBe("application/gzip");
    expect(sniffContent(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c)).kind).toBe("archive");
    expect(sniffContent(text("Rar!\x1a\x07\x00")).kind).toBe("archive");
    const tar = new Uint8Array(512);
    tar.set(text("ustar"), 257);
    expect(sniffContent(tar).kind).toBe("archive");
  });

  it("detects active/scriptable content whatever the wrapper", () => {
    expect(sniffContent(text("<!DOCTYPE html><html><body>hi")).mimeType).toBe("text/html");
    expect(sniffContent(text("  \n<script>fetch('/api')</script>")).mimeType).toBe("text/html");
    expect(
      sniffContent(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')).mimeType,
    ).toBe("image/svg+xml");
    expect(sniffContent(text('<?xml version="1.0"?><svg><script/></svg>')).mimeType).toBe(
      "image/svg+xml",
    );
    expect(sniffContent(text('<?xml version="1.0"?><note>hi</note>')).kind).toBe("active");
  });

  it("detects images whose metadata cannot be stripped", () => {
    expect(sniffContent(bytes(0x49, 0x49, 0x2a, 0x00, 8)).kind).toBe("image-unscrubbable"); // TIFF LE
    expect(sniffContent(bytes(0x4d, 0x4d, 0x00, 0x2a, 0)).kind).toBe("image-unscrubbable"); // TIFF BE
    const heic = new Uint8Array(16);
    heic.set(text("\x00\x00\x00\x18ftypheic"), 0);
    expect(sniffContent(heic).mimeType).toBe("image/heic");
    const avif = new Uint8Array(16);
    avif.set(text("\x00\x00\x00\x1cftypavif"), 0);
    expect(sniffContent(avif).mimeType).toBe("image/avif");
  });
});

describe("sniffContent — documents, text, opaque bytes", () => {
  it("identifies a PDF", () => {
    expect(sniffContent(text("%PDF-1.7\n1 0 obj\n")).kind).toBe("document");
  });

  it("treats decodable UTF-8 as text and undecodable bytes as opaque", () => {
    expect(sniffContent(text("Ran 5k in 24:10 — splits attached")).kind).toBe("text");
    expect(sniffContent(bytes(0x00, 0xff, 0xfe, 0x03, 0x91)).kind).toBe("unknown");
    expect(sniffContent(new Uint8Array(0)).label).toBe("empty");
  });
});

describe("normaliseMime", () => {
  it("lowercases, drops parameters and folds aliases", () => {
    expect(normaliseMime("IMAGE/JPG")).toBe("image/jpeg");
    expect(normaliseMime("text/plain; charset=UTF-8")).toBe("text/plain");
    expect(normaliseMime("image/x-png")).toBe("image/png");
    expect(normaliseMime("text/xml")).toBe("application/xml");
  });
});

describe("assertSniffedContentAllowed — policy", () => {
  const png = asset("agent-mark.png");

  it("accepts a real image and returns the corroborated type", () => {
    expect(
      assertSniffedContentAllowed({ bytes: png, declaredMimeType: "image/png" }),
    ).toMatchObject({ effectiveMimeType: "image/png" });
    // An alias is folded, not rejected.
    expect(
      assertSniffedContentAllowed({ bytes: asset("hero-topo.jpg"), declaredMimeType: "image/jpg" })
        .effectiveMimeType,
    ).toBe("image/jpeg");
  });

  it("adopts the sniffed type when the upload is unlabelled or opaque", () => {
    expect(assertSniffedContentAllowed({ bytes: png }).effectiveMimeType).toBe("image/png");
    expect(
      assertSniffedContentAllowed({ bytes: png, declaredMimeType: "application/octet-stream" })
        .effectiveMimeType,
    ).toBe("image/png");
    // Unknown binary with no label stays opaque — the one uncorroborated path (§13).
    expect(
      assertSniffedContentAllowed({ bytes: bytes(0x00, 0xff, 0xfe, 0x03, 0x91) }).effectiveMimeType,
    ).toBeUndefined();
  });

  it("refuses a payload whose declared type contradicts its bytes", () => {
    expect(() =>
      assertSniffedContentAllowed({ bytes: png, declaredMimeType: "image/jpeg" }),
    ).toThrow(/declared as image\/jpeg but its content is image\/png/);
    expect(() =>
      assertSniffedContentAllowed({ bytes: text("just a note"), declaredMimeType: "image/png" }),
    ).toThrow(/content is plain text/);
    expect(() =>
      assertSniffedContentAllowed({
        bytes: bytes(0x00, 0xff, 0xfe, 0x03, 0x91),
        declaredMimeType: "application/pdf",
      }),
    ).toThrow(/does not match that format/);
  });

  it("refuses an executable disguised as an image (the spoofing attack)", () => {
    const elfAsPng = bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0);
    const call = () =>
      assertSniffedContentAllowed({ bytes: elfAsPng, declaredMimeType: "image/png" });
    expect(call).toThrow(EvidenceContentRejectedError);
    expect(call).toThrow(/executable/);
  });

  it("refuses archives, active content and unscrubbable images by class", () => {
    expect(() => assertSniffedContentAllowed({ bytes: bytes(0x50, 0x4b, 0x03, 0x04) })).toThrow(
      /archive/,
    );
    expect(() =>
      assertSniffedContentAllowed({
        bytes: text("<svg onload=alert(1)>"),
        declaredMimeType: "image/svg+xml",
      }),
    ).toThrow(/active\/scriptable/);
    expect(() =>
      assertSniffedContentAllowed({ bytes: text("<html><body>x"), declaredMimeType: "text/html" }),
    ).toThrow(/active\/scriptable/);
    expect(() =>
      assertSniffedContentAllowed({
        bytes: bytes(0x49, 0x49, 0x2a, 0x00, 8),
        declaredMimeType: "image/tiff",
      }),
    ).toThrow(/cannot be stripped/);
  });

  it("accepts text under any text-ish declared type", () => {
    const note = text("day 3: 5k done");
    expect(
      assertSniffedContentAllowed({ bytes: note, declaredMimeType: "text/plain" })
        .effectiveMimeType,
    ).toBe("text/plain");
    expect(
      assertSniffedContentAllowed({ bytes: note, declaredMimeType: "text/markdown" })
        .effectiveMimeType,
    ).toBe("text/markdown");
    expect(
      assertSniffedContentAllowed({
        bytes: text('{"steps":8123}'),
        declaredMimeType: "application/json",
      }).effectiveMimeType,
    ).toBe("application/json");
  });
});
