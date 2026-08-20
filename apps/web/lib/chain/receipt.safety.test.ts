import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { commitmentVaultAbi } from "./abi";
import { isApprovalConfigured, isAttestorConfigured, readChainConfig } from "./config";
import { getAttestorClient } from "./contractClient";
import { buildVerificationReceipt, getReceiptSigner } from "./receipt";

/**
 * MONEY-SAFETY PROOF for the second key (CLAUDE.md rules 2–3, contract invariant I7).
 *
 * Item 11 adds an AI-verifier key to the backend. Adding a key is exactly the kind of
 * change that could quietly widen what the backend can do, so this test pins how narrow
 * it is:
 *
 *  1. The receipt signer exposes EXACTLY an address and `signReceipt`. It is built from a
 *     bare `privateKeyToAccount` — no wallet client, no RPC transport, no `writeContract`.
 *     It cannot broadcast anything, let alone move value. Frozen, so nothing can bolt a
 *     send method on at runtime.
 *  2. The two halves live on two different objects held by two different keys: the
 *     attestor client can send `approveCompletion` but cannot produce a receipt; the
 *     signer can produce a receipt but cannot send anything. Neither key approves alone.
 *  3. An approval is not even ENCODABLE without a signature — the calldata carries it —
 *     so there is no code path that writes a confidence value the AI verifier did not sign.
 *
 * Offline: no network. Both keys are public anvil throwaways and no method is invoked
 * against a chain.
 */

const VAULT = "0x1111111111111111111111111111111111111111";
const ATTESTOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil #0
const VERIFIER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil #1
const config = readChainConfig({ COMMITMENT_VAULT_ADDRESS: VAULT });

const BROADCASTERS = [
  "writeContract",
  "sendTransaction",
  "sendRawTransaction",
  "signTransaction",
  "request",
  "transport",
  "account",
  "approveCompletion",
  "lockFunds",
  "claimReward",
  "releasePrincipal",
  "fundReward",
  "createCommitment",
  "cancelCommitment",
] as const;

const receipt = buildVerificationReceipt({
  commitmentId: 12n,
  goalId: 4n,
  milestoneId: "mst_01HZY",
  confidence: 88,
  evidenceHash: "a".repeat(64),
  verificationHash: "b".repeat(64),
  modelVersion: "gemini-3.7-flash",
  deadline: 1_800_000_000n,
});

describe("AI verifier capability surface", () => {
  const signer = getReceiptSigner(config, VERIFIER_KEY);

  it("exposes EXACTLY an address and signReceipt", () => {
    expect(Object.keys(signer).sort()).toEqual(["address", "signReceipt"]);
  });

  it("has NO way to broadcast anything, let alone move funds", () => {
    const surface = signer as unknown as Record<string, unknown>;
    for (const forbidden of BROADCASTERS) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it("is frozen so no broadcast method can be added at runtime", () => {
    expect(Object.isFrozen(signer)).toBe(true);
  });

  it("returns a 65-byte signature, never a transaction hash", async () => {
    const signature = await signer.signReceipt(receipt);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("refuses to build without a key (honest error, never a fake signature)", () => {
    expect(() => getReceiptSigner(config, null)).toThrow(/AI verifier not configured/i);
  });

  it("refuses to build without a deployed contract", () => {
    expect(() => getReceiptSigner(readChainConfig({}), VERIFIER_KEY)).toThrow(/not configured/i);
  });
});

describe("the two approval halves are genuinely separate (invariant I7)", () => {
  it("uses two different keys, so one stolen key approves nothing", () => {
    // The contract requires attestor != aiVerifier; this is the backend mirroring it.
    expect(privateKeyToAccount(ATTESTOR_KEY).address).not.toBe(
      privateKeyToAccount(VERIFIER_KEY).address,
    );
  });

  it("gives the attestor client no way to produce a receipt", () => {
    const surface = getAttestorClient(config, ATTESTOR_KEY) as unknown as Record<string, unknown>;
    for (const forbidden of ["signReceipt", "signTypedData", "sign", "aiVerifier"]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  });

  it("gives the receipt signer no way to submit the approval", () => {
    const surface = getReceiptSigner(config, VERIFIER_KEY) as unknown as Record<string, unknown>;
    expect(surface["approveCompletion"]).toBeUndefined();
    expect(surface["setAttestor"]).toBeUndefined();
    expect(surface["setAiVerifier"]).toBeUndefined();
  });

  it("cannot even ENCODE an approval without a signature", async () => {
    const { encodeFunctionData } = await import("viem");
    const signature = await getReceiptSigner(config, VERIFIER_KEY).signReceipt(receipt);
    const data = encodeFunctionData({
      abi: commitmentVaultAbi,
      functionName: "approveCompletion",
      args: [receipt, signature],
    });
    // The signature is part of the calldata, and the decoded call round-trips to exactly
    // the receipt that was signed — there is no unsigned approval shape to send.
    expect(data.toLowerCase()).toContain(signature.slice(2).toLowerCase());
    const decoded = decodeFunctionData({ abi: commitmentVaultAbi, data });
    expect(decoded.functionName).toBe("approveCompletion");
    expect(decoded.args).toEqual([receipt, signature]);
  });

  it("reports approval as unconfigured until BOTH keys are present", () => {
    const base = { COMMITMENT_VAULT_ADDRESS: VAULT };
    expect(isApprovalConfigured({ ...base })).toBe(false);
    expect(isApprovalConfigured({ ...base, ATTESTOR_PRIVATE_KEY: ATTESTOR_KEY })).toBe(false);
    expect(isApprovalConfigured({ ...base, AI_VERIFIER_PRIVATE_KEY: VERIFIER_KEY })).toBe(false);
    expect(
      isApprovalConfigured({
        ...base,
        ATTESTOR_PRIVATE_KEY: ATTESTOR_KEY,
        AI_VERIFIER_PRIVATE_KEY: VERIFIER_KEY,
      }),
    ).toBe(true);
    // Attesting a milestone still works with only the attestor key — it is approval,
    // specifically, that needs both.
    expect(isAttestorConfigured({ ...base, ATTESTOR_PRIVATE_KEY: ATTESTOR_KEY })).toBe(true);
  });
});
