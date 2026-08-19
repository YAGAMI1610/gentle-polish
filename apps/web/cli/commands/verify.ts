/**
 * `commitai verify` — the deterministic verification primitives from
 * lib/ai/verification and lib/chain. All pure and reproducible: no model call,
 * no network, no key.
 */
import { SignalLevel } from "@prisma/client";
import { computeVerificationHash } from "../../lib/ai/verification/verificationHash";
import {
  calculateVerificationConfidence,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "../../lib/ai/verification/confidence";
import { hashToBytes32, milestoneRefFromId } from "../../lib/chain/index";
import { emit, printHelp, usage, fail, contentFromSources, EXIT_OK, type GlobalOptions } from "../runtime";
import { parse, requirePositional, parsePercent, parseSignalLevel, requireHash64 } from "../format";

export const HELP = `
commitai verify — deterministic verification primitives (pure)

Usage:
  commitai verify hash --goal-id <s> --timestamp <iso|unix> \\
                       [--result <json> | --result-file <path> | <stdin>] \\
                       [--milestone-id <s>] [--evidence-hash <hex>] [--model <s>]
  commitai verify confidence --plausibility <low|medium|high> \\
                             --evidence <low|medium|high> \\
                             --consistency <low|medium|high> [--threshold <0..100>]
  commitai verify bytes32 <hash>            Normalise a 64-hex hash to a 0x bytes32.
  commitai verify milestone-ref <id>        keccak256 milestone reference for a DB id.

Commands:
  hash          Canonical sha256 verification hash (the digest anchored on-chain).
  confidence    Combine three signal levels into a 0-100 confidence + status.
  bytes32       Validate/normalise a content hash for the contract.
  milestone-ref Derive the on-chain milestone reference from an off-chain id.`;

export async function run(
  command: string | undefined,
  args: string[],
  global: GlobalOptions,
): Promise<number> {
  if (global.help || command === undefined) {
    printHelp(HELP);
    return EXIT_OK;
  }

  switch (command) {
    case "hash":
      return runHash(args, global);
    case "confidence":
      return runConfidence(args, global);
    case "bytes32": {
      const { positionals } = parse(args);
      const hex = requireHash64("hash", requirePositional(positionals, "hash"));
      const out = hashToBytes32(hex);
      emit({ bytes32: out }, global, () => out);
      return EXIT_OK;
    }
    case "milestone-ref": {
      const { positionals } = parse(args);
      const id = requirePositional(positionals, "id");
      const ref = milestoneRefFromId(id);
      emit({ milestoneId: id, milestoneRef: ref }, global, () => ref);
      return EXIT_OK;
    }
    default:
      usage(`unknown verify command "${command}" (see: commitai verify --help)`);
  }
}

function runHash(args: string[], global: GlobalOptions): number {
  const { values } = parse(args, {
    "goal-id": { type: "string" },
    "milestone-id": { type: "string" },
    "evidence-hash": { type: "string" },
    model: { type: "string" },
    timestamp: { type: "string" },
    result: { type: "string" },
    "result-file": { type: "string" },
  });

  const goalId = values["goal-id"];
  if (typeof goalId !== "string" || goalId === "") usage("missing required option --goal-id");

  const timestampRaw = values["timestamp"];
  if (typeof timestampRaw !== "string" || timestampRaw === "") {
    usage("missing required option --timestamp (an ISO date or unix seconds)");
  }
  const timestamp = normalizeTimestamp(timestampRaw);

  const evidenceHash =
    typeof values["evidence-hash"] === "string"
      ? requireHash64("evidence-hash", values["evidence-hash"])
      : null;

  // Result is any JSON value, from --result, --result-file, or stdin.
  const rawResult = contentFromSources({
    text: typeof values["result"] === "string" ? values["result"] : undefined,
    file: typeof values["result-file"] === "string" ? values["result-file"] : undefined,
  });
  let result: unknown;
  try {
    result = JSON.parse(rawResult);
  } catch {
    usage("--result / --result-file / stdin must be valid JSON");
  }

  const hash = computeVerificationHash({
    goalId,
    milestoneId: typeof values["milestone-id"] === "string" ? values["milestone-id"] : null,
    result,
    timestamp,
    evidenceHash,
    modelVersion: typeof values["model"] === "string" ? values["model"] : null,
  });

  emit({ hash, timestamp, goalId }, global, () => hash);
  return EXIT_OK;
}

function runConfidence(args: string[], global: GlobalOptions): number {
  const { values } = parse(args, {
    plausibility: { type: "string" },
    evidence: { type: "string" },
    consistency: { type: "string" },
    threshold: { type: "string" },
  });
  const plausibility = parseSignalLevel("plausibility", requireLevel(values, "plausibility"));
  const evidence = parseSignalLevel("evidence", requireLevel(values, "evidence"));
  const consistency = parseSignalLevel("consistency", requireLevel(values, "consistency"));
  const threshold =
    typeof values["threshold"] === "string"
      ? parsePercent("threshold", values["threshold"])
      : DEFAULT_CONFIDENCE_THRESHOLD;

  const result = calculateVerificationConfidence(
    {
      plausibility: SignalLevel[plausibility],
      evidenceQuality: SignalLevel[evidence],
      consistency: SignalLevel[consistency],
    },
    threshold,
  );

  emit(
    { ...result, threshold },
    global,
    () => `confidence=${result.confidence} status=${result.status} (threshold=${threshold})`,
  );
  return EXIT_OK;
}

function requireLevel(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (typeof v !== "string" || v === "") usage(`missing required option --${name} (low|medium|high)`);
  return v;
}

/** Accept ISO 8601 or unix seconds; return a canonical ISO string. */
function normalizeTimestamp(raw: string): string {
  const v = raw.trim();
  const ms = /^\d+$/.test(v) ? Number(v) * 1000 : Date.parse(v);
  if (Number.isNaN(ms)) usage(`--timestamp must be an ISO date or unix seconds, got "${raw}"`);
  try {
    return new Date(ms).toISOString();
  } catch {
    fail(`--timestamp is out of range: "${raw}"`);
  }
}
