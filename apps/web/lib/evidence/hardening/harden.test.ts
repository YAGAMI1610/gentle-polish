import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EvidenceContentRejectedError,
  EvidenceMalwareDetectedError,
  EvidenceScanUnavailableError,
} from "../errors";
import { hardenEvidenceBytes } from "./harden";
import type { MalwareScanTarget, MalwareScanVerdict, MalwareScanner } from "./scanner";

/**
 * The hardening boundary as a whole (LIMITATIONS §13, item 10): sniff+policy →
 * malware scan of the ORIGINAL bytes → metadata scrub. Real image fixtures, real
 * magic bytes for every refused class, and a recording scanner that proves the
 * ordering guarantee (a signature hidden in EXIF must get the upload refused, not
 * quietly sanitised).
 *
 * `scanner: null` is passed explicitly wherever a scan isn't the subject, so no test
 * depends on the ambient environment.
 */

const asset = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(process.cwd(), "public", "assets", name)));

const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "latin1"));

/** Records what it was handed, so we can assert WHICH bytes were scanned. */
class RecordingScanner implements MalwareScanner {
  readonly name = "recorder";
  readonly seen: MalwareScanTarget[] = [];
  constructor(private readonly verdict: MalwareScanVerdict | Error) {}
  async scan(target: MalwareScanTarget): Promise<MalwareScanVerdict> {
    this.seen.push(target);
    if (this.verdict instanceof Error) throw this.verdict;
    return this.verdict;
  }
}

describe("hardenEvidenceBytes — content policy", () => {
  it("accepts a real PNG, strips its metadata and reports what it removed", async () => {
    const original = asset("agent-mark.png");
    const result = await hardenEvidenceBytes(
      { bytes: original, mimeType: "image/png", fileName: "mark.png" },
      { scanner: null },
    );

    expect(result.mimeType).toBe("image/png");
    expect(result.bytes.byteLength).toBeLessThan(original.byteLength);
    expect(result.report).toEqual({
      sniffedMimeType: "image/png",
      sniffedFormat: "png",
      declaredMimeType: "image/png",
      metadataRemoved: ["png:iTXt"],
      scanned: false,
      originalSizeBytes: original.byteLength,
      storedSizeBytes: result.bytes.byteLength,
    });
  });

  it("adopts the sniffed type when the client declared nothing", async () => {
    const result = await hardenEvidenceBytes({ bytes: asset("hero-topo.jpg") }, { scanner: null });
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.report.declaredMimeType).toBeUndefined();
    expect(result.report.metadataRemoved).toEqual(["jpeg:APP1(XMP)"]);
  });

  it("rejects an executable dressed up as a PNG", async () => {
    const elf = new Uint8Array(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0);
    await expect(
      hardenEvidenceBytes(
        { bytes: elf, mimeType: "image/png", fileName: "proof.png" },
        {
          scanner: null,
        },
      ),
    ).rejects.toBeInstanceOf(EvidenceContentRejectedError);
  });

  it("rejects HTML and SVG, which the MIME allowlist alone would have admitted", async () => {
    for (const payload of [
      "<!doctype html><script>fetch('/api/goals')</script>",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ]) {
      await expect(
        hardenEvidenceBytes({ bytes: bytesOf(payload), mimeType: "text/plain" }, { scanner: null }),
      ).rejects.toThrow(/active\/scriptable/);
    }
  });

  it("rejects archives, whose contents cannot be sniffed", async () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    await expect(
      hardenEvidenceBytes({ bytes: zip, mimeType: "application/pdf" }, { scanner: null }),
    ).rejects.toThrow(/archive/i);
  });

  it("rejects a real PNG that claims to be a PDF (declared vs actual mismatch)", async () => {
    await expect(
      hardenEvidenceBytes(
        { bytes: asset("agent-mark.png"), mimeType: "application/pdf" },
        {
          scanner: null,
        },
      ),
    ).rejects.toThrow(/declared as application\/pdf but its content is image\/png/);
  });
});

describe("hardenEvidenceBytes — malware scanning hook", () => {
  const png = asset("agent-mark.png");

  it("records a clean verdict and the scanner that gave it", async () => {
    const scanner = new RecordingScanner({ clean: true, scanner: "recorder" });
    const result = await hardenEvidenceBytes({ bytes: png, mimeType: "image/png" }, { scanner });

    expect(result.report.scanned).toBe(true);
    expect(result.report.scanner).toBe("recorder");
  });

  it("scans the ORIGINAL bytes, before metadata is stripped", async () => {
    const scanner = new RecordingScanner({ clean: true, scanner: "recorder" });
    const result = await hardenEvidenceBytes(
      { bytes: png, mimeType: "image/png", fileName: "mark.png" },
      { scanner },
    );

    expect(scanner.seen).toHaveLength(1);
    const seen = scanner.seen[0];
    // The scanner saw the full upload — including the iTXt block the scrub removed,
    // so a signature hidden in metadata cannot be sanitised into looking clean.
    expect(seen?.bytes.byteLength).toBe(png.byteLength);
    expect(seen?.bytes.byteLength).toBeGreaterThan(result.bytes.byteLength);
    expect(seen?.fileName).toBe("mark.png");
    expect(seen?.mimeType).toBe("image/png");
  });

  it("refuses the upload when a signature matches", async () => {
    const scanner = new RecordingScanner({
      clean: false,
      scanner: "recorder",
      signature: "Unix.Trojan.Test-1",
    });
    const error = await hardenEvidenceBytes(
      { bytes: png, mimeType: "image/png" },
      { scanner },
    ).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(EvidenceMalwareDetectedError);
    expect((error as EvidenceMalwareDetectedError).signature).toBe("Unix.Trojan.Test-1");
    expect((error as EvidenceMalwareDetectedError).scanner).toBe("recorder");
  });

  it("fails closed when a configured scanner cannot produce a verdict", async () => {
    const scanner = new RecordingScanner(new EvidenceScanUnavailableError("recorder", "down"));
    await expect(
      hardenEvidenceBytes({ bytes: png, mimeType: "image/png" }, { scanner }),
    ).rejects.toBeInstanceOf(EvidenceScanUnavailableError);
  });

  it("does not claim a scan when scanning is off", async () => {
    const result = await hardenEvidenceBytes(
      { bytes: png, mimeType: "image/png" },
      {
        scanner: null,
      },
    );
    expect(result.report.scanned).toBe(false);
    expect(result.report.scanner).toBeUndefined();
  });

  it("rejects dangerous content before the scanner is ever consulted", async () => {
    const scanner = new RecordingScanner({ clean: true, scanner: "recorder" });
    await expect(
      hardenEvidenceBytes({ bytes: bytesOf("<html><body>hi"), mimeType: "text/html" }, { scanner }),
    ).rejects.toBeInstanceOf(EvidenceContentRejectedError);
    expect(scanner.seen).toEqual([]);
  });
});
