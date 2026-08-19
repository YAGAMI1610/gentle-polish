/**
 * `commitai prepare` — build UNSIGNED transaction calldata for the CommitmentVault,
 * using the app's real `prepare*` encoders (lib/chain).
 *
 * Money-safety (CLAUDE.md rules 2-3): every command here returns calldata only.
 * Nothing is signed or broadcast, and no private key is ever read. The output is
 * meant to be signed by the DEPOSITOR's own wallet — the backend/CLI never can.
 */
import type { Address, Hex } from "viem";
import {
  prepareRegisterGoal,
  prepareCreateCommitment,
  prepareLockFunds,
  prepareFundReward,
  prepareReleasePrincipal,
  prepareClaimReward,
  prepareCancelCommitment,
  type PreparedTx,
} from "../../lib/chain/index";
import {
  emit,
  note,
  printHelp,
  usage,
  resolveChainConfig,
  EXIT_OK,
  type GlobalOptions,
} from "../runtime";
import { parse, parseId, parseAmountWei, parseDeadline, parsePercent, requireHash64 } from "../format";
import { formatEther } from "viem";

export const HELP = `
commitai prepare — build UNSIGNED CommitmentVault calldata (sign with your own wallet)

Usage:
  commitai prepare register-goal      --goal-hash <hex>
  commitai prepare create-commitment  --goal-id <n> --principal <BOT> --reward <BOT> \\
                                      --deadline <0|unix|iso> --grace <seconds> --threshold <1..100>
  commitai prepare lock-funds         --commitment <id> --principal <BOT>
  commitai prepare fund-reward        --commitment <id> --reward <BOT>
  commitai prepare release-principal  --commitment <id>
  commitai prepare claim-reward       --commitment <id>
  commitai prepare cancel             --commitment <id>

Output is an unsigned tx { chainId, to, data, value } — the backend never signs or
broadcasts it. Requires a deployed vault address (from .env or --vault).`;

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
  let tx: PreparedTx;

  switch (command) {
    case "register-goal": {
      const { values } = parse(args, { "goal-hash": { type: "string" } });
      const goalHash = values["goal-hash"];
      if (typeof goalHash !== "string") usage("missing required option --goal-hash");
      tx = prepareRegisterGoal(`0x${requireHash64("goal-hash", goalHash)}` as Hex, config);
      break;
    }
    case "create-commitment": {
      const { values } = parse(args, {
        "goal-id": { type: "string" },
        principal: { type: "string" },
        reward: { type: "string" },
        deadline: { type: "string" },
        grace: { type: "string" },
        threshold: { type: "string" },
      });
      const threshold = parsePercent("threshold", requireOpt(values, "threshold"));
      if (threshold < 1) usage("--threshold must be between 1 and 100");
      tx = prepareCreateCommitment(
        {
          goalId: parseId("goal-id", requireOpt(values, "goal-id")),
          principalWei: parseAmountWei("principal", requireOpt(values, "principal")),
          rewardWei: parseAmountWei("reward", requireOpt(values, "reward")),
          deadline: parseDeadline("deadline", requireOpt(values, "deadline")),
          gracePeriodSeconds: parseId("grace", requireOpt(values, "grace")),
          confidenceThreshold: threshold,
        },
        config,
      );
      break;
    }
    case "lock-funds": {
      const { values } = parse(args, { commitment: { type: "string" }, principal: { type: "string" } });
      tx = prepareLockFunds(
        parseId("commitment", requireOpt(values, "commitment")),
        parseAmountWei("principal", requireOpt(values, "principal")),
        config,
      );
      break;
    }
    case "fund-reward": {
      const { values } = parse(args, { commitment: { type: "string" }, reward: { type: "string" } });
      tx = prepareFundReward(
        parseId("commitment", requireOpt(values, "commitment")),
        parseAmountWei("reward", requireOpt(values, "reward")),
        config,
      );
      break;
    }
    case "release-principal": {
      const { values } = parse(args, { commitment: { type: "string" } });
      tx = prepareReleasePrincipal(parseId("commitment", requireOpt(values, "commitment")), config);
      break;
    }
    case "claim-reward": {
      const { values } = parse(args, { commitment: { type: "string" } });
      tx = prepareClaimReward(parseId("commitment", requireOpt(values, "commitment")), config);
      break;
    }
    case "cancel": {
      const { values } = parse(args, { commitment: { type: "string" } });
      tx = prepareCancelCommitment(parseId("commitment", requireOpt(values, "commitment")), config);
      break;
    }
    default:
      usage(`unknown prepare command "${command}" (see: commitai prepare --help)`);
  }

  emit(txToJson(tx), global, () => renderTx(command, tx));
  note("↳ unsigned tx — sign it with the depositor's own wallet; the backend never broadcasts it.", global);
  return EXIT_OK;
}

function requireOpt(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (typeof v !== "string" || v === "") usage(`missing required option --${name}`);
  return v;
}

function txToJson(tx: PreparedTx): { chainId: number; to: Address; data: Hex; value: string } {
  return { chainId: tx.chainId, to: tx.to, data: tx.data, value: tx.value.toString() };
}

function renderTx(command: string, tx: PreparedTx): string {
  return [
    `prepared: ${command}`,
    `  chainId  ${tx.chainId}`,
    `  to       ${tx.to}`,
    `  value    ${tx.value} wei (${formatEther(tx.value)} BOT)`,
    `  data     ${tx.data}`,
  ].join("\n");
}
