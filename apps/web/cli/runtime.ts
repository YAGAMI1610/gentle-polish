/**
 * CLI runtime: env loading, chain-config resolution, output discipline and the
 * error/exit-code model shared by every command.
 *
 * Design rules (mirror the app's CLAUDE.md):
 *  - No fakes. Every command calls the app's real core (lib/chain, lib/ai/*).
 *    When something isn't configured, we say so and exit non-zero — never invent
 *    an address, hash, or result.
 *  - No secret leakage. We load apps/web/.env so reads work against the deployed
 *    vault, but we NEVER print an env value; `doctor` reports presence booleans only.
 *  - Clean streams. Machine data goes to stdout; hints/notes and errors go to
 *    stderr, so `--json` output and pipes stay uncontaminated.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isAddress } from "viem";
import { readChainConfig, type ChainConfig } from "../lib/chain/index";

export const CLI_NAME = "commitai";
export const CLI_VERSION = "0.1.0";

// Conventional exit codes.
export const EXIT_OK = 0;
export const EXIT_ERROR = 1; // runtime failure (RPC down, not configured, bad state)
export const EXIT_USAGE = 2; // the user invoked the CLI wrong (bad/missing args)

/** A user-facing error. `usage: true` maps to exit code 2, otherwise 1. */
export class CliError extends Error {
  readonly usage: boolean;
  constructor(message: string, opts: { usage?: boolean } = {}) {
    super(message);
    this.name = "CliError";
    this.usage = opts.usage ?? false;
  }
}

/** Throw a runtime error (exit 1). */
export function fail(message: string): never {
  throw new CliError(message);
}

/** Throw a usage error (exit 2). */
export function usage(message: string): never {
  throw new CliError(message, { usage: true });
}

export interface GlobalOptions {
  json: boolean;
  quiet: boolean;
  debug: boolean;
  noEnv: boolean;
  help: boolean;
  version: boolean;
  rpc?: string | undefined;
  vault?: string | undefined;
  chainId?: number | undefined;
}

/**
 * Flags accepted by every command. Merged into each command's own option set for
 * the strict parse, and used on its own for a lenient pre-parse in `main` (to find
 * the group/command and read globals before dispatch).
 */
export const GLOBAL_OPTION_SPEC = {
  json: { type: "boolean" },
  quiet: { type: "boolean" },
  debug: { type: "boolean" },
  "no-env": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "V" },
  rpc: { type: "string" },
  vault: { type: "string" },
  "chain-id": { type: "string" },
} as const;

/** Extract the typed GlobalOptions from a parsed `values` bag. */
export function pickGlobals(values: Record<string, unknown>): GlobalOptions {
  const chainIdRaw = values["chain-id"];
  return {
    json: values["json"] === true,
    quiet: values["quiet"] === true,
    debug: values["debug"] === true,
    noEnv: values["no-env"] === true,
    help: values["help"] === true,
    version: values["version"] === true,
    rpc: typeof values["rpc"] === "string" ? values["rpc"] : undefined,
    vault: typeof values["vault"] === "string" ? values["vault"] : undefined,
    chainId: typeof chainIdRaw === "string" ? Number(chainIdRaw) : undefined,
  };
}

/** Print help text to stdout (requested output, not an error). */
export function printHelp(text: string): void {
  process.stdout.write(text.trimStart() + "\n");
}

const CLI_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal `.env` loader — deliberately dependency-free. Reads apps/web/.env (the
 * file next to the web app) and sets any keys NOT already present in the
 * environment, so real CLI flags and a caller's exported vars always win. Values
 * are never logged. Missing file is not an error (flags/defaults still work).
 */
export function loadEnv(global: GlobalOptions): void {
  if (global.noEnv) return;
  const envPath = resolve(CLI_DIR, "..", ".env");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return; // no .env — fine; chain reads fall back to public testnet defaults
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * Resolve the effective chain config: the app's env-derived config, with explicit
 * `--rpc` / `--vault` / `--chain-id` overrides applied on top. Malformed overrides
 * fail loudly here rather than degrading to a silent default.
 */
export function resolveChainConfig(global: GlobalOptions): ChainConfig {
  let base: ChainConfig;
  try {
    base = readChainConfig();
  } catch (err) {
    // A set-but-malformed env var (e.g. a bad COMMITMENT_VAULT_ADDRESS) throws.
    fail(err instanceof Error ? err.message : String(err));
  }

  let vaultAddress = base.vaultAddress;
  if (global.vault !== undefined) {
    if (!isAddress(global.vault)) usage(`--vault is not a valid address: "${global.vault}"`);
    vaultAddress = global.vault.toLowerCase() as `0x${string}`;
  }

  let chainId = base.chainId;
  if (global.chainId !== undefined) {
    if (!Number.isInteger(global.chainId) || global.chainId <= 0) {
      usage(`--chain-id must be a positive integer, got "${global.chainId}"`);
    }
    chainId = global.chainId;
  }

  const rpcUrl = global.rpc ?? base.rpcUrl;
  if (global.rpc !== undefined && !/^https?:\/\//i.test(global.rpc)) {
    usage(`--rpc must be an http(s) URL, got "${global.rpc}"`);
  }

  return { chainId, rpcUrl, explorerUrl: base.explorerUrl, vaultAddress };
}

/** JSON.stringify replacer that renders bigints as decimal strings. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Emit a command result. In `--json` mode the structured value is printed to
 * stdout as JSON; otherwise the caller's human renderer runs. Either way, data
 * goes to stdout only.
 */
export function emit(result: unknown, global: GlobalOptions, human: () => string): void {
  if (global.json) {
    process.stdout.write(JSON.stringify(result, jsonReplacer, 2) + "\n");
  } else {
    process.stdout.write(human() + "\n");
  }
}

/** A hint/annotation for humans. Suppressed by `--quiet` and in `--json` mode; stderr only. */
export function note(message: string, global: GlobalOptions): void {
  if (global.quiet || global.json) return;
  process.stderr.write(message + "\n");
}

/** Read all of stdin as UTF-8 (used by input-taking commands). */
export function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Resolve text content from (in priority) `--text`, `--file`, or piped stdin.
 * Refuses to block on an interactive TTY: with no source it raises a clear usage
 * error rather than hanging waiting for input.
 */
export function contentFromSources(opts: {
  text?: string | undefined;
  file?: string | undefined;
}): string {
  const { text, file } = opts;
  if (text !== undefined && file !== undefined) usage("pass only one of --text or --file");
  if (text !== undefined) return text;
  if (file !== undefined) {
    try {
      return readFileSync(resolve(file), "utf8");
    } catch (err) {
      fail(`cannot read --file "${file}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (process.stdin.isTTY) {
    usage("no input: pass --text <string>, --file <path>, or pipe text on stdin");
  }
  return readStdin();
}
