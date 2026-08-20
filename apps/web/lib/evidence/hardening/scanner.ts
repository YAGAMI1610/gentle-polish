/**
 * The malware-scanning hook for evidence uploads (LIMITATIONS §13, item 10).
 *
 * `MalwareScanner` is the seam: one method, injectable everywhere the pipeline
 * touches it, so any engine (clamd today; an ICAP gateway, VirusTotal, or a cloud
 * scanning API tomorrow) is a class that implements this interface — no change to
 * the evidence pipeline.
 *
 * Honest gating (rule 1, the `lib/chain/config.ts` / `lib/connectors/config.ts`
 * idiom): scanning is OFF unless `EVIDENCE_MALWARE_SCAN` selects a driver, and a
 * selected driver with missing settings throws loudly instead of silently
 * degrading. When it is off, uploads are stored UNSCANNED and the hardening report
 * says `scanned: false` — the pipeline never claims a scan it did not run.
 */
import { ClamdScanner, type ClamdConfig } from "./clamd";

export interface MalwareScanTarget {
  readonly bytes: Uint8Array;
  readonly fileName?: string;
  readonly mimeType?: string;
}

export type MalwareScanVerdict =
  | { readonly clean: true; readonly scanner: string }
  | { readonly clean: false; readonly scanner: string; readonly signature: string };

export interface MalwareScanner {
  /** Stable driver name, recorded in the hardening report. */
  readonly name: string;
  /**
   * Scan a payload. Resolves with a verdict, or throws
   * `EvidenceScanUnavailableError` when no verdict could be obtained (fail-closed).
   */
  scan(target: MalwareScanTarget): Promise<MalwareScanVerdict>;
}

export type ScanEnv = Record<string, string | undefined>;

export type MalwareScanSettings =
  { readonly driver: "off" } | { readonly driver: "clamd"; readonly clamd: ClamdConfig };

const DEFAULT_CLAMD_PORT = 3310;
const DEFAULT_CLAMD_TIMEOUT_MS = 10_000;

function requiredEnv(env: ScanEnv, key: string): string {
  const raw = env[key]?.trim();
  if (!raw) {
    throw new Error(
      `EVIDENCE_MALWARE_SCAN="clamd" requires ${key} — set it or unset EVIDENCE_MALWARE_SCAN (see LIMITATIONS.md §13).`,
    );
  }
  return raw;
}

function positiveInt(env: ScanEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Resolve the scan settings from the environment. Throws on a misconfiguration. */
export function readMalwareScanConfig(env: ScanEnv): MalwareScanSettings {
  const driver = (env["EVIDENCE_MALWARE_SCAN"] ?? "off").trim().toLowerCase();
  switch (driver) {
    case "":
    case "off":
    case "none":
      return { driver: "off" };
    case "clamd":
      return {
        driver: "clamd",
        clamd: {
          host: requiredEnv(env, "EVIDENCE_CLAMD_HOST"),
          port: positiveInt(env, "EVIDENCE_CLAMD_PORT", DEFAULT_CLAMD_PORT),
          timeoutMs: positiveInt(env, "EVIDENCE_CLAMD_TIMEOUT_MS", DEFAULT_CLAMD_TIMEOUT_MS),
        },
      };
    default:
      throw new Error(
        `unknown EVIDENCE_MALWARE_SCAN "${driver}" — supported: "off", "clamd" (see LIMITATIONS.md §13)`,
      );
  }
}

/** Build the scanner a settings object selects, or null when scanning is off. */
export function createMalwareScanner(settings: MalwareScanSettings): MalwareScanner | null {
  return settings.driver === "clamd" ? new ClamdScanner(settings.clamd) : null;
}

let singleton: MalwareScanner | null | undefined;

/**
 * The configured scanner, memoised. `null` means scanning is deliberately off —
 * distinct from "not yet resolved", so a caller can tell the two apart.
 */
export function getMalwareScanner(env: ScanEnv = process.env): MalwareScanner | null {
  if (singleton !== undefined) return singleton;
  singleton = createMalwareScanner(readMalwareScanConfig(env));
  return singleton;
}

/** Test seam: forget the memoised scanner so a test can change the environment. */
export function __resetMalwareScannerForTests(): void {
  singleton = undefined;
}
