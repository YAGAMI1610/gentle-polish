import { describe, expect, it } from "vitest";
import { ClamdScanner } from "./clamd";
import {
  __resetMalwareScannerForTests,
  createMalwareScanner,
  getMalwareScanner,
  readMalwareScanConfig,
  type ScanEnv,
} from "./scanner";

/**
 * Scan-configuration honesty (LIMITATIONS §13, item 10) — the same contract the
 * chain/storage/connector configs are held to: OFF by default, LOUD on a
 * half-configured driver, never a silent fallback that would make the pipeline
 * report a scan it never ran.
 */

describe("readMalwareScanConfig", () => {
  it("is off when unset, empty, or explicitly disabled", () => {
    for (const env of [
      {},
      { EVIDENCE_MALWARE_SCAN: "" },
      { EVIDENCE_MALWARE_SCAN: "   " },
      { EVIDENCE_MALWARE_SCAN: "off" },
      { EVIDENCE_MALWARE_SCAN: "None" },
    ] satisfies ScanEnv[]) {
      expect(readMalwareScanConfig(env)).toEqual({ driver: "off" });
    }
  });

  it("reads clamd settings, defaulting the port and timeout", () => {
    expect(
      readMalwareScanConfig({ EVIDENCE_MALWARE_SCAN: "clamd", EVIDENCE_CLAMD_HOST: "clamav" }),
    ).toEqual({
      driver: "clamd",
      clamd: { host: "clamav", port: 3310, timeoutMs: 10_000 },
    });
  });

  it("honours explicit port and timeout overrides", () => {
    expect(
      readMalwareScanConfig({
        EVIDENCE_MALWARE_SCAN: "CLAMD",
        EVIDENCE_CLAMD_HOST: "127.0.0.1",
        EVIDENCE_CLAMD_PORT: "3311",
        EVIDENCE_CLAMD_TIMEOUT_MS: "2500",
      }),
    ).toEqual({ driver: "clamd", clamd: { host: "127.0.0.1", port: 3311, timeoutMs: 2500 } });
  });

  it("refuses a clamd driver with no host instead of silently disabling the scan", () => {
    expect(() => readMalwareScanConfig({ EVIDENCE_MALWARE_SCAN: "clamd" })).toThrow(
      /requires EVIDENCE_CLAMD_HOST/,
    );
  });

  it("refuses nonsense port and timeout values", () => {
    const base = { EVIDENCE_MALWARE_SCAN: "clamd", EVIDENCE_CLAMD_HOST: "clamav" };
    expect(() => readMalwareScanConfig({ ...base, EVIDENCE_CLAMD_PORT: "0" })).toThrow(
      /EVIDENCE_CLAMD_PORT must be a positive integer/,
    );
    expect(() => readMalwareScanConfig({ ...base, EVIDENCE_CLAMD_PORT: "3310.5" })).toThrow(
      /positive integer/,
    );
    expect(() => readMalwareScanConfig({ ...base, EVIDENCE_CLAMD_TIMEOUT_MS: "soon" })).toThrow(
      /EVIDENCE_CLAMD_TIMEOUT_MS must be a positive integer/,
    );
  });

  it("refuses an unknown driver rather than guessing", () => {
    expect(() => readMalwareScanConfig({ EVIDENCE_MALWARE_SCAN: "virustotal" })).toThrow(
      /unknown EVIDENCE_MALWARE_SCAN "virustotal"/,
    );
  });
});

describe("createMalwareScanner", () => {
  it("returns null when scanning is off", () => {
    expect(createMalwareScanner({ driver: "off" })).toBeNull();
  });

  it("builds a real clamd scanner for the clamd driver", () => {
    const scanner = createMalwareScanner({
      driver: "clamd",
      clamd: { host: "clamav", port: 3310, timeoutMs: 10_000 },
    });
    expect(scanner).toBeInstanceOf(ClamdScanner);
    expect(scanner?.name).toBe("clamd");
  });
});

describe("getMalwareScanner", () => {
  it("memoises the resolved scanner and can be reset for tests", () => {
    __resetMalwareScannerForTests();
    const off = getMalwareScanner({});
    expect(off).toBeNull();

    // Memoised: the new environment is ignored until the cache is cleared.
    expect(
      getMalwareScanner({ EVIDENCE_MALWARE_SCAN: "clamd", EVIDENCE_CLAMD_HOST: "h" }),
    ).toBeNull();

    __resetMalwareScannerForTests();
    const on = getMalwareScanner({ EVIDENCE_MALWARE_SCAN: "clamd", EVIDENCE_CLAMD_HOST: "h" });
    expect(on).toBeInstanceOf(ClamdScanner);
    __resetMalwareScannerForTests();
  });

  it("propagates a misconfiguration instead of caching a null scanner", () => {
    __resetMalwareScannerForTests();
    expect(() => getMalwareScanner({ EVIDENCE_MALWARE_SCAN: "clamd" })).toThrow(
      /requires EVIDENCE_CLAMD_HOST/,
    );
    __resetMalwareScannerForTests();
  });
});
