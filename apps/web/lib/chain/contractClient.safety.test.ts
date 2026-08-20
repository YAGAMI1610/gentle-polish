import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { commitmentVaultAbi } from "./abi";
import { readChainConfig } from "./config";
import {
  getAttestorClient,
  prepareCancelCommitment,
  prepareClaimReward,
  prepareCreateCommitment,
  prepareFundReward,
  prepareLockFunds,
  prepareRegisterGoal,
  prepareReleasePrincipal,
} from "./contractClient";

/**
 * MONEY-SAFETY PROOF (CLAUDE.md rules 2–3). This test is the guarantee, in code,
 * that the backend cannot move a user's funds:
 *
 *  1. The attestor client exposes EXACTLY the four value-neutral, attestor-permitted
 *     contract functions — registerMilestone, requestCompletion, approveCompletion,
 *     setAttestor — and NONE of the fund-moving ones. There is literally no method on
 *     the object the backend key could call to transfer value. The object is frozen,
 *     so nothing can bolt one on at runtime. `approveCompletion` is additionally
 *     two-of-two: the contract rejects it without a receipt signed by the distinct
 *     `aiVerifier` key (invariant I7) — proved in `receipt.safety.test.ts`.
 *  2. Every fund-relevant action is a pure `prepare*` encoder that returns calldata
 *     for the DEPOSITOR's own wallet to sign — it never broadcasts and never needs a
 *     key. `createCommitment` / `claimReward` / `releasePrincipal` / `cancel` attach
 *     zero value; only the depositor's own `lockFunds` / `fundReward` carry value in.
 *
 * Nothing here connects to a network: it introspects object shape and encodes
 * calldata offline. The attestor client is built with a PUBLIC anvil throwaway key
 * and a dummy vault address, and no method on it is ever invoked.
 */

const VAULT = "0x1111111111111111111111111111111111111111";
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const config = readChainConfig({ COMMITMENT_VAULT_ADDRESS: VAULT });

const FUND_MOVERS = [
  "lockFunds",
  "fundReward",
  "releasePrincipal",
  "claimReward",
  "createCommitment",
  "cancelCommitment",
] as const;

describe("attestor client capability surface", () => {
  const client = getAttestorClient(config, ANVIL_KEY);

  it("exposes EXACTLY the four value-neutral attestor methods", () => {
    expect(Object.keys(client).sort()).toEqual([
      "approveCompletion",
      "registerMilestone",
      "requestCompletion",
      "setAttestor",
    ]);
  });

  it("has NO fund-moving method of any kind", () => {
    const surface = client as unknown as Record<string, unknown>;
    for (const forbidden of FUND_MOVERS) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });

  it("is frozen so no fund-moving method can be added at runtime", () => {
    expect(Object.isFrozen(client)).toBe(true);
  });

  it("cannot approve a completion on its own — the receipt is a required argument", () => {
    // The signature is part of the call, so this key alone cannot write a confidence
    // value; the AI-verifier key (a separate object, separate secret) must sign first.
    const args = commitmentVaultAbi.find(
      (i) => i.type === "function" && i.name === "approveCompletion",
    ) as { inputs: readonly { name?: string; type: string }[] };
    expect(args.inputs.map((i) => i.type)).toEqual(["tuple", "bytes"]);
    expect(args.inputs[1]?.name).toBe("signature");
  });

  it("refuses to build without a key (honest error, never a fake)", () => {
    expect(() => getAttestorClient(config, null)).toThrow(/attestor not configured/i);
  });

  it("refuses to build without a deployed contract", () => {
    expect(() => getAttestorClient(readChainConfig({}), ANVIL_KEY)).toThrow(/not configured/i);
  });
});

describe("prepare* encoders return unsigned calldata only", () => {
  const B32 = `0x${"cd".repeat(32)}` as `0x${string}`;

  const cases = [
    { name: "registerGoal", tx: prepareRegisterGoal(B32, config), value: 0n },
    {
      name: "createCommitment",
      tx: prepareCreateCommitment(
        {
          goalId: 1n,
          principalWei: 1_000_000n,
          rewardWei: 500n,
          deadline: 0n,
          gracePeriodSeconds: 3600n,
          confidenceThreshold: 70,
        },
        config,
      ),
      value: 0n, // creation moves no funds
    },
    { name: "lockFunds", tx: prepareLockFunds(1n, 1_000_000n, config), value: 1_000_000n },
    { name: "fundReward", tx: prepareFundReward(1n, 500n, config), value: 500n },
    { name: "releasePrincipal", tx: prepareReleasePrincipal(1n, config), value: 0n },
    { name: "claimReward", tx: prepareClaimReward(1n, config), value: 0n },
    { name: "cancelCommitment", tx: prepareCancelCommitment(1n, config), value: 0n },
  ];

  it.each(cases)("$name encodes to the vault with the expected value", ({ name, tx, value }) => {
    expect(tx.to).toBe(VAULT);
    expect(tx.chainId).toBe(config.chainId);
    expect(tx.data.startsWith("0x")).toBe(true);
    expect(tx.value).toBe(value);
    // The calldata really is the function it claims to be (decoded from the ABI).
    const decoded = decodeFunctionData({ abi: commitmentVaultAbi, data: tx.data });
    expect(decoded.functionName).toBe(name);
  });

  it("only the depositor's own deposits (lockFunds/fundReward) carry value", () => {
    const valued = cases
      .filter((c) => c.value > 0n)
      .map((c) => c.name)
      .sort();
    expect(valued).toEqual(["fundReward", "lockFunds"]);
  });
});
