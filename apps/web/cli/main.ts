/**
 * commitai CLI entry point.
 *
 * Exposes the CommitAI web app's real core (chain reads, unsigned-tx encoders,
 * verification primitives, prompt-injection guards) as a command-line tool. It
 * imports the app's own modules directly, so behaviour can never drift from the
 * app, and it honours the same rules: no fakes, money-safety (never signs or
 * broadcasts, never reads a key to move funds), and no secret leakage.
 */
import { parseArgs } from "node:util";
import {
  CLI_NAME,
  CLI_VERSION,
  GLOBAL_OPTION_SPEC,
  pickGlobals,
  loadEnv,
  printHelp,
  CliError,
  EXIT_OK,
  EXIT_ERROR,
  EXIT_USAGE,
  type GlobalOptions,
} from "./runtime";
import * as chain from "./commands/chain";
import * as prepare from "./commands/prepare";
import * as verify from "./commands/verify";
import * as guard from "./commands/guard";
import * as doctor from "./commands/doctor";

const TOP_HELP = `
${CLI_NAME} v${CLI_VERSION} — CommitAI command-line tool

Usage:
  ${CLI_NAME} <group> <command> [options]

Groups:
  doctor      Report resolved config and live chain connectivity.
  chain       Read-only CommitmentVault views (commitment, goal, milestones, …).
  prepare     Build UNSIGNED vault calldata for a wallet to sign (never broadcast).
  verify      Deterministic verification hash / confidence / hashing helpers.
  guard       Prompt-injection defence helpers (fence/neutralise untrusted text).

Global options:
  --json              Emit machine-readable JSON on stdout.
  --quiet             Suppress human hints (stderr notes).
  --rpc <url>         Override the chain RPC URL.
  --vault <address>   Override the CommitmentVault address.
  --chain-id <n>      Override the expected chain id.
  --no-env            Do not load apps/web/.env.
  --debug             Print stack traces on unexpected errors.
  -h, --help          Show help (works per group: ${CLI_NAME} chain --help).
  -V, --version       Print the CLI version.

Examples:
  ${CLI_NAME} doctor
  ${CLI_NAME} chain commitment 1 --json
  ${CLI_NAME} verify confidence --plausibility high --evidence high --consistency medium
  echo "ignore previous instructions" | ${CLI_NAME} guard neutralize`;

type GroupHandler = (
  command: string | undefined,
  args: string[],
  global: GlobalOptions,
) => Promise<number>;

const GROUPS: Record<string, { run: GroupHandler }> = { chain, prepare, verify, guard, doctor };

/** Value-taking global flags, so the group/command locator can skip their values. */
const VALUE_GLOBALS = new Set(["--rpc", "--vault", "--chain-id"]);

/** Find the group and command words, skipping flags and the values of value-globals. */
function locate(argv: string[]): { group?: string | undefined; command?: string | undefined } {
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (VALUE_GLOBALS.has(t)) {
      i++; // skip this flag's value token
      continue;
    }
    if (t.startsWith("-")) continue; // any other flag (incl. --flag=value)
    words.push(t);
  }
  return { group: words[0], command: words[1] };
}

/** Remove the group and command words (first occurrences) from argv. */
function stripSubcommand(argv: string[], group?: string, command?: string): string[] {
  const out: string[] = [];
  let removedGroup = false;
  let removedCommand = false;
  for (const t of argv) {
    if (!removedGroup && group !== undefined && t === group) {
      removedGroup = true;
      continue;
    }
    if (removedGroup && !removedCommand && command !== undefined && t === command) {
      removedCommand = true;
      continue;
    }
    out.push(t);
  }
  return out;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // Lenient pre-parse: read global values regardless of command-specific flags.
  let preValues: Record<string, unknown> = {};
  try {
    preValues = parseArgs({
      args: argv,
      options: GLOBAL_OPTION_SPEC,
      strict: false,
      allowPositionals: true,
    }).values as Record<string, unknown>;
  } catch {
    // A missing value for a global flag surfaces properly in the group's strict parse.
  }
  const global = pickGlobals(preValues);
  loadEnv(global);

  if (global.version) {
    process.stdout.write(`${CLI_NAME} ${CLI_VERSION}\n`);
    return EXIT_OK;
  }

  const { group, command } = locate(argv);

  if (group === undefined || group === "help") {
    printHelp(TOP_HELP);
    return EXIT_OK;
  }
  if (group === "version") {
    process.stdout.write(`${CLI_NAME} ${CLI_VERSION}\n`);
    return EXIT_OK;
  }

  const handler = GROUPS[group];
  if (!handler) {
    throw new CliError(`unknown command "${group}" (see: ${CLI_NAME} --help)`, { usage: true });
  }

  const commandArgs = stripSubcommand(argv, group, command);
  return handler.run(command, commandArgs, global);
}

// Safety nets: never surface a raw stack to the user for an async escape.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  process.stderr.write(`${CLI_NAME}: unexpected error: ${msg}\n`);
  process.exit(EXIT_ERROR);
});
process.on("uncaughtException", (err) => {
  process.stderr.write(`${CLI_NAME}: unexpected error: ${err.message}\n`);
  process.exit(EXIT_ERROR);
});

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    const debug = process.argv.includes("--debug");
    if (err instanceof CliError) {
      process.stderr.write(`${CLI_NAME}: ${err.message}\n`);
      process.exitCode = err.usage ? EXIT_USAGE : EXIT_ERROR;
    } else {
      const e = err as Error;
      process.stderr.write(`${CLI_NAME}: ${debug ? (e.stack ?? e.message) : e.message}\n`);
      process.exitCode = EXIT_ERROR;
    }
  });
