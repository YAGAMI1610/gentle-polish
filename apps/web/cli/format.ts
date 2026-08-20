/**
 * Parsing + formatting helpers shared by commands.
 *
 * Parsers turn CLI strings into the exact types the core functions expect
 * (bigint ids, wei amounts, unix deadlines, signal levels) and raise a clean
 * usage error on bad input. Formatters render on-chain structs (returned by viem
 * as named objects) into readable text, decoding enum bytes and wei/timestamps.
 */
import { parseArgs, type ParseArgsConfig } from "node:util";
import { parseEther, formatEther } from "viem";
import { commitmentStatusName } from "../lib/chain/index";
import { usage, GLOBAL_OPTION_SPEC } from "./runtime";

type OptionConfig = NonNullable<ParseArgsConfig["options"]>;

/**
 * Wrap node's `parseArgs` so unknown/malformed flags become a friendly usage
 * error (exit 2) instead of an ugly TypeError with a stack trace. The global
 * flags (--json, --rpc, …) are merged in automatically, so commands declare only
 * their own options.
 */
export function parse(
  args: string[],
  options: OptionConfig = {},
): { values: Record<string, unknown>; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ...GLOBAL_OPTION_SPEC, ...options },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as Record<string, unknown>, positionals };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    usage(message);
  }
}

/** Require a single positional argument, or a clear usage error naming it. */
export function requirePositional(positionals: string[], name: string): string {
  const value = positionals[0];
  if (value === undefined || value === "") usage(`missing required argument <${name}>`);
  if (positionals.length > 1) usage(`unexpected extra argument "${positionals[1]}"`);
  return value;
}

/** Require a string flag to be present and non-empty. */
export function requireString(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== "string" || value === "") usage(`missing required option --${name}`);
  return value;
}

/** Parse a non-negative integer id into bigint. */
export function parseId(name: string, raw: string): bigint {
  if (!/^\d+$/.test(raw.trim())) usage(`--${name} must be a non-negative integer, got "${raw}"`);
  return BigInt(raw.trim());
}

/** Parse a decimal BOT amount (e.g. "1.5") into wei. */
export function parseAmountWei(name: string, raw: string): bigint {
  const v = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(v))
    usage(`--${name} must be a non-negative decimal amount, got "${raw}"`);
  try {
    return parseEther(v);
  } catch {
    usage(`--${name} is not a valid amount: "${raw}"`);
  }
}

/** Parse a confidence threshold / confidence value in 0..100. */
export function parsePercent(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    usage(`--${name} must be an integer 0..100, got "${raw}"`);
  }
  return n;
}

/**
 * Parse a deadline: "0" (open-ended), a unix-seconds integer, or an ISO 8601
 * datetime. Returns unix seconds as bigint. Rejects times in the past for a real
 * deadline (0 is always allowed) so a typo can't create an already-expired term.
 */
export function parseDeadline(name: string, raw: string): bigint {
  const v = raw.trim();
  if (v === "0") return 0n;
  let seconds: number;
  if (/^\d+$/.test(v)) {
    seconds = Number(v);
  } else {
    const ms = Date.parse(v);
    if (Number.isNaN(ms)) usage(`--${name} must be 0, unix seconds, or an ISO date; got "${raw}"`);
    seconds = Math.floor(ms / 1000);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (seconds <= nowSeconds) {
    usage(
      `--${name} is in the past (${new Date(seconds * 1000).toISOString()}); use 0 for open-ended`,
    );
  }
  return BigInt(seconds);
}

const SIGNAL_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type SignalLevelName = (typeof SIGNAL_LEVELS)[number];

/** Parse a signal level, accepting low/med/medium/high in any case. */
export function parseSignalLevel(name: string, raw: string): SignalLevelName {
  const v = raw.trim().toUpperCase();
  const canonical = v === "MED" ? "MEDIUM" : v;
  if (!SIGNAL_LEVELS.includes(canonical as SignalLevelName)) {
    usage(`--${name} must be one of low|medium|high, got "${raw}"`);
  }
  return canonical as SignalLevelName;
}

/** Validate a 32-byte hex hash (with or without 0x). Returns the bare 64-hex lowercased. */
export function requireHash64(name: string, raw: string): string {
  const hex = raw.trim().startsWith("0x") ? raw.trim().slice(2) : raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    usage(`--${name} must be a 32-byte hash (64 hex chars, optional 0x), got "${raw}"`);
  }
  return hex.toLowerCase();
}

// --- formatters -------------------------------------------------------------

/** ISO string for a unix-seconds value, or "—" for 0/none. */
function tsToIso(seconds: bigint): string {
  if (seconds === 0n) return "—";
  return new Date(Number(seconds) * 1000).toISOString();
}

/** Render an on-chain Commitment struct (named object from viem) as readable text. */
export function formatCommitment(id: bigint, c: Record<string, unknown>): string {
  const status = commitmentStatusName(c["status"] as number | bigint);
  const line = (label: string, value: string) => `  ${label.padEnd(20)} ${value}`;
  return [
    `Commitment #${id}`,
    line("status", `${status} (${String(c["status"])})`),
    line("goalId", String(c["goalId"])),
    line("depositor", String(c["depositor"])),
    line("rewardFunder", String(c["rewardFunder"])),
    line("principal", `${formatEther(c["principalAmount"] as bigint)} BOT`),
    line("reward", `${formatEther(c["rewardAmount"] as bigint)} BOT`),
    line("deadline", tsToIso(c["deadline"] as bigint)),
    line("gracePeriod", `${String(c["gracePeriod"])} s`),
    line("createdAt", tsToIso(c["createdAt"] as bigint)),
    line("confidenceThresh", `${String(c["confidenceThreshold"])}`),
    line("rewardFunded", String(c["rewardFunded"])),
    line("principalWithdrawn", String(c["principalWithdrawn"])),
    line("rewardWithdrawn", String(c["rewardWithdrawn"])),
    line("verificationHash", String(c["verificationHash"])),
    line("attestedConfidence", String(c["attestedConfidence"])),
  ].join("\n");
}

/** Render an on-chain Goal struct. */
export function formatGoal(id: bigint, g: Record<string, unknown>): string {
  return [
    `Goal #${id}`,
    `  owner                ${String(g["owner"])}`,
    `  registeredAt         ${tsToIso(g["registeredAt"] as bigint)}`,
    `  goalHash             ${String(g["goalHash"])}`,
  ].join("\n");
}

/** Render the milestone records for a goal. */
export function formatMilestones(
  goalId: bigint,
  records: readonly Record<string, unknown>[],
): string {
  if (records.length === 0) return `Goal #${goalId}: no milestones registered`;
  const rows = records.map(
    (m, i) =>
      `  [${i}] ref=${String(m["milestoneRef"])}\n` +
      `      verificationHash=${String(m["verificationHash"])}\n` +
      `      registeredAt=${tsToIso(m["registeredAt"] as bigint)} confidence=${String(m["confidence"])}`,
  );
  return [`Goal #${goalId}: ${records.length} milestone(s)`, ...rows].join("\n");
}
