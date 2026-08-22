/**
 * `commitai doctor` — report the resolved environment and live chain connectivity.
 *
 * Prints only non-secret facts and presence booleans: it NEVER echoes an env value
 * (no keys, URLs-with-creds, or addresses beyond the public vault). Use it to check
 * a checkout is wired up before running reads or preparing transactions.
 */
import { aiApiKeyEnvVar, aiProviderName } from "../../lib/ai/factory";
import { getChainId, readAttestorKey } from "../../lib/chain/index";
import {
  emit,
  printHelp,
  resolveChainConfig,
  EXIT_OK,
  EXIT_ERROR,
  type GlobalOptions,
} from "../runtime";
import { parse } from "../format";

export const HELP = `
commitai doctor — report resolved config + live chain connectivity

Usage:
  commitai doctor [--offline] [--strict]

Options:
  --offline   Skip the live RPC round-trip (report config only).
  --strict    Exit non-zero if the chain is unreachable or the vault is unconfigured.

Never prints secret values — only presence booleans.`;

/** True when an env var is present and non-empty. Value is never returned. */
function isSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim() !== "";
}

export async function run(
  _command: string | undefined,
  args: string[],
  global: GlobalOptions,
): Promise<number> {
  if (global.help) {
    printHelp(HELP);
    return EXIT_OK;
  }

  const { values } = parse(args, {
    offline: { type: "boolean" },
    strict: { type: "boolean" },
  });
  const offline = values["offline"] === true;
  const strict = values["strict"] === true;

  const config = resolveChainConfig(global);
  const chainConfigured = config.vaultAddress !== null;
  const attestorConfigured = chainConfigured && readAttestorKey() !== null;

  let liveChainId: number | null = null;
  let rpcReachable: boolean | null = offline ? null : false;
  let rpcError: string | null = null;
  if (!offline) {
    try {
      liveChainId = await getChainId(config);
      rpcReachable = true;
    } catch (err) {
      rpcReachable = false;
      rpcError = (err as { shortMessage?: string })?.shortMessage ?? "RPC unreachable";
    }
  }

  // Which model key matters depends on AI_PROVIDER, so report the SELECTED provider's
  // key instead of a hardcoded one: a doctor that always names GEMINI_API_KEY is just
  // wrong on a Groq deployment. Both keys' presence is reported either way (holding
  // both in one env is fine — only the selected one is required). A typo'd selector is
  // reported as the error it is rather than crashing the whole report.
  let aiProvider: string;
  let aiKeyVar: string | null;
  try {
    aiProvider = aiProviderName();
    aiKeyVar = aiApiKeyEnvVar();
  } catch (err) {
    aiProvider = `INVALID — ${err instanceof Error ? err.message : "unknown value"}`;
    aiKeyVar = null;
  }

  const report = {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    explorerUrl: config.explorerUrl,
    vaultAddress: config.vaultAddress,
    chainConfigured,
    attestorConfigured,
    rpcReachable,
    liveChainId,
    chainIdMatches: liveChainId === null ? null : liveChainId === config.chainId,
    aiProvider,
    aiApiKeyEnvVar: aiKeyVar,
    aiConfigured: aiKeyVar !== null && isSet(aiKeyVar),
    present: {
      DATABASE_URL: isSet("DATABASE_URL"),
      GEMINI_API_KEY: isSet("GEMINI_API_KEY"),
      GROQ_API_KEY: isSet("GROQ_API_KEY"),
      SESSION_PASSWORD: isSet("SESSION_PASSWORD"),
    },
  };

  emit(report, global, () => renderReport(report, rpcError));

  if (strict && (!chainConfigured || (!offline && !rpcReachable))) {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

function yn(v: boolean | null): string {
  return v === null ? "—" : v ? "yes" : "no";
}

function renderReport(
  r: {
    chainId: number;
    rpcUrl: string;
    explorerUrl: string;
    vaultAddress: string | null;
    chainConfigured: boolean;
    attestorConfigured: boolean;
    rpcReachable: boolean | null;
    liveChainId: number | null;
    chainIdMatches: boolean | null;
    aiProvider: string;
    aiApiKeyEnvVar: string | null;
    aiConfigured: boolean;
    present: Record<string, boolean>;
  },
  rpcError: string | null,
): string {
  const line = (label: string, value: string) => `  ${label.padEnd(20)} ${value}`;
  const out = [
    "commitai doctor",
    line("chainId (config)", String(r.chainId)),
    line("rpcUrl", r.rpcUrl),
    line("explorerUrl", r.explorerUrl),
    line("vaultAddress", r.vaultAddress ?? "not configured"),
    line("chain configured", yn(r.chainConfigured)),
    line("attestor configured", yn(r.attestorConfigured)),
    line("rpc reachable", yn(r.rpcReachable) + (rpcError ? ` (${rpcError})` : "")),
    line("live chainId", r.liveChainId === null ? "—" : String(r.liveChainId)),
    line("chainId matches", yn(r.chainIdMatches)),
    line("ai provider", r.aiProvider),
    line("ai key required", r.aiApiKeyEnvVar ?? "—"),
    line("ai configured", yn(r.aiConfigured)),
    "  present (booleans; values never shown):",
    line("  DATABASE_URL", yn(r.present["DATABASE_URL"] ?? false)),
    line("  GEMINI_API_KEY", yn(r.present["GEMINI_API_KEY"] ?? false)),
    line("  GROQ_API_KEY", yn(r.present["GROQ_API_KEY"] ?? false)),
    line("  SESSION_PASSWORD", yn(r.present["SESSION_PASSWORD"] ?? false)),
  ];
  return out.join("\n");
}
