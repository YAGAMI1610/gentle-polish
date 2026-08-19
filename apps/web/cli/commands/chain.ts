/**
 * `commitai chain` — live, read-only views of the deployed CommitmentVault via the
 * app's real chain client (lib/chain). Pure view calls: they move no funds and
 * need no key. Reads (except `id` and `explorer`) require a deployed vault address.
 */
import { isAddress, type Address } from "viem";
import {
  getChainId,
  readCommitment,
  readCommitmentStatus,
  readGoal,
  readMilestones,
  readWalletGoals,
  readWalletCommitments,
  readCancellationOpensAt,
  commitmentStatusName,
  explorerTxUrl,
  explorerAddressUrl,
} from "../../lib/chain/index";
import {
  emit,
  printHelp,
  usage,
  fail,
  resolveChainConfig,
  EXIT_OK,
  type GlobalOptions,
} from "../runtime";
import {
  parse,
  requirePositional,
  parseId,
  formatCommitment,
  formatGoal,
  formatMilestones,
} from "../format";

export const HELP = `
commitai chain — read-only CommitmentVault views (no funds move, no key)

Usage:
  commitai chain id                              Live chain id reported by the RPC.
  commitai chain commitment <id>                 Full on-chain commitment record.
  commitai chain status <id>                     Commitment status (name + raw byte).
  commitai chain goal <id>                       On-chain goal record.
  commitai chain milestones <goalId>             Registered milestones for a goal.
  commitai chain wallet-goals <address>          Goal ids owned by a wallet.
  commitai chain wallet-commitments <address>    Commitment ids for a wallet.
  commitai chain cancellation-opens <id>         When cancellation opens for a commitment.
  commitai chain explorer <address|txhash> [--tx]  Block-explorer URL.

Global: --rpc <url> --vault <address> --chain-id <n> override the resolved config.`;

export async function run(
  command: string | undefined,
  args: string[],
  global: GlobalOptions,
): Promise<number> {
  if (global.help || command === undefined) {
    printHelp(HELP);
    return EXIT_OK;
  }

  const config = resolveChainConfig(global);
  const { values, positionals } = parse(args, { tx: { type: "boolean" } });

  switch (command) {
    case "id": {
      const id = await withChain(() => getChainId(config), "read chain id");
      emit({ chainId: id }, global, () => String(id));
      return EXIT_OK;
    }
    case "commitment": {
      const id = parseId("id", requirePositional(positionals, "id"));
      const c = (await withChain(
        () => readCommitment(id, config),
        `read commitment #${id}`,
      )) as Record<string, unknown>;
      emit({ commitmentId: id, ...c }, global, () => formatCommitment(id, c));
      return EXIT_OK;
    }
    case "status": {
      const id = parseId("id", requirePositional(positionals, "id"));
      const raw = await withChain(() => readCommitmentStatus(id, config), `read status #${id}`);
      const name = commitmentStatusName(raw);
      emit({ commitmentId: id, status: name, raw }, global, () => `${name} (${raw})`);
      return EXIT_OK;
    }
    case "goal": {
      const id = parseId("id", requirePositional(positionals, "id"));
      const g = (await withChain(() => readGoal(id, config), `read goal #${id}`)) as Record<
        string,
        unknown
      >;
      emit({ goalId: id, ...g }, global, () => formatGoal(id, g));
      return EXIT_OK;
    }
    case "milestones": {
      const id = parseId("goalId", requirePositional(positionals, "goalId"));
      const records = (await withChain(
        () => readMilestones(id, config),
        `read milestones for goal #${id}`,
      )) as readonly Record<string, unknown>[];
      emit({ goalId: id, milestones: records }, global, () => formatMilestones(id, records));
      return EXIT_OK;
    }
    case "wallet-goals": {
      const wallet = requireAddress(requirePositional(positionals, "address"));
      const ids = await withChain(() => readWalletGoals(wallet, config), "read wallet goals");
      emit({ wallet, goalIds: ids }, global, () => renderIdList("goal", ids));
      return EXIT_OK;
    }
    case "wallet-commitments": {
      const wallet = requireAddress(requirePositional(positionals, "address"));
      const ids = await withChain(
        () => readWalletCommitments(wallet, config),
        "read wallet commitments",
      );
      emit({ wallet, commitmentIds: ids }, global, () => renderIdList("commitment", ids));
      return EXIT_OK;
    }
    case "cancellation-opens": {
      const id = parseId("id", requirePositional(positionals, "id"));
      const opensAt = await withChain(
        () => readCancellationOpensAt(id, config),
        `read cancellation window for #${id}`,
      );
      const iso = opensAt === 0n ? "not applicable" : new Date(Number(opensAt) * 1000).toISOString();
      emit(
        { commitmentId: id, opensAt, opensAtIso: iso },
        global,
        () => `commitment #${id} cancellation opens at ${opensAt} (${iso})`,
      );
      return EXIT_OK;
    }
    case "explorer": {
      const value = requirePositional(positionals, "address|txhash");
      const url = (values["tx"] === true ? explorerTxUrl : explorerAddressUrl)(
        value,
        config.explorerUrl,
      );
      emit({ url }, global, () => url);
      return EXIT_OK;
    }
    default:
      usage(`unknown chain command "${command}" (see: commitai chain --help)`);
  }
}

/** Run a chain call, turning viem/network errors into a concise CLI error (no stack). */
async function withChain<T>(fn: () => Promise<T>, action: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const short =
      (err as { shortMessage?: string })?.shortMessage ??
      (err instanceof Error ? err.message.split("\n")[0] : String(err)) ??
      String(err);
    // A bare revert on a view almost always means the id/target doesn't exist yet.
    // State it as a possibility (never a certainty — a revert can have other causes).
    const hint = /revert/i.test(short)
      ? " — the target may not exist on-chain yet, or the contract rejected the call"
      : "";
    fail(`failed to ${action}: ${short}${hint}`);
  }
}

function requireAddress(raw: string): Address {
  if (!isAddress(raw)) usage(`not a valid address: "${raw}"`);
  return raw as Address;
}

function renderIdList(label: string, ids: readonly bigint[]): string {
  if (ids.length === 0) return `no ${label}s`;
  return `${ids.length} ${label}(s): ${ids.map((i) => `#${i}`).join(", ")}`;
}
