import { describe, expect, it } from "vitest";
import { keccak256, recoverTypedDataAddress, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readChainConfig } from "./config";
import { milestoneRefFromId } from "./contractClient";
import {
  buildVerificationReceipt,
  getReceiptSigner,
  hashVerificationReceipt,
  isReceiptExpired,
  isValidVerificationReceiptSignature,
  receiptDeadline,
  recoverVerificationReceiptSigner,
  VERIFICATION_RECEIPT_DOMAIN_NAME,
  VERIFICATION_RECEIPT_DOMAIN_VERSION,
  VERIFICATION_RECEIPT_TYPE_STRING,
  VERIFICATION_RECEIPT_TYPEHASH,
  verificationReceiptDomain,
  type VerificationReceipt,
} from "./receipt";

/**
 * Signed verification receipts (LIMITATIONS.md item 11). Always-on: pure hashing and
 * signing, no network, and no key from the environment — the tests bring their own
 * public anvil key.
 *
 * The load-bearing test is `matches the digest fixture the Solidity suite asserts`: the
 * same domain + receipt is hashed by viem here and by `_hashTypedDataV4` in
 * `contracts/test/CommitmentVault.t.sol` (test_receiptDigest_matchesTheCrossLanguageFixture),
 * both against this one constant. If either side's type string, field order, or domain
 * ever drifts, a suite fails instead of the backend signing a receipt the chain rejects —
 * or, worse, one that means something other than the decision the AI actually made.
 */

// Public anvil account #0 — a throwaway test key, never a real one.
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

// The FIXED fixture shared with the Solidity suite: chain 968 (BOT Chain testnet) and the
// vault address from the deployment notes, so the digest is deterministic on both sides.
const FIXTURE_VAULT = "0x0076c4269bE298429af7827A2A5CC40A65F8F8a8" as const;
const FIXTURE_CONFIG = readChainConfig({
  COMMITMENT_VAULT_ADDRESS: FIXTURE_VAULT,
  BOTCHAIN_TESTNET_CHAIN_ID: "968",
});
const FIXTURE_RECEIPT: VerificationReceipt = {
  commitmentId: 7n,
  goalId: 3n,
  milestoneRef: `0x${"11".repeat(32)}`,
  confidence: 92,
  evidenceHash: `0x${"22".repeat(32)}`,
  verificationHash: `0x${"33".repeat(32)}`,
  modelVersionHash: `0x${"44".repeat(32)}`,
  deadline: 1_800_000_000n,
};
const FIXTURE_DIGEST = "0xec7008deb512eb12f8c881413a14f989bad7409e0c4b25936c50c8b87927a437";

// A generic configured deployment for the non-fixture tests.
const VAULT = "0x1111111111111111111111111111111111111111" as const;
const config = readChainConfig({ COMMITMENT_VAULT_ADDRESS: VAULT });

const SHA256 = "a".repeat(64);
const OTHER_SHA256 = "b".repeat(64);

function sampleReceipt(): VerificationReceipt {
  return buildVerificationReceipt({
    commitmentId: 12n,
    goalId: 4n,
    milestoneId: "mst_01HZY",
    confidence: 88,
    evidenceHash: SHA256,
    verificationHash: OTHER_SHA256,
    modelVersion: "gemini-3.7-flash",
    deadline: 1_800_000_000n,
  });
}

describe("EIP-712 type definition", () => {
  it("pins the canonical type string and its typehash", () => {
    expect(VERIFICATION_RECEIPT_TYPE_STRING).toBe(
      "VerificationReceipt(uint256 commitmentId,uint256 goalId,bytes32 milestoneRef," +
        "uint16 confidence,bytes32 evidenceHash,bytes32 verificationHash," +
        "bytes32 modelVersionHash,uint256 deadline)",
    );
    expect(VERIFICATION_RECEIPT_TYPEHASH).toBe(keccak256(toHex(VERIFICATION_RECEIPT_TYPE_STRING)));
    // Independently computed from the Solidity constant (`cast keccak` of the same type
    // string); test_verificationReceiptTypeHash_matchesTheDocumentedTypeString asserts
    // the contract side.
    expect(VERIFICATION_RECEIPT_TYPEHASH).toBe(
      "0x53073819e79382fd4049dbe900b7a8eaa4d71c04a94d25b20ac0a3a95fa89e31",
    );
  });

  it("builds the domain from the deployed chain id and vault address", () => {
    expect(verificationReceiptDomain(FIXTURE_CONFIG)).toEqual({
      name: VERIFICATION_RECEIPT_DOMAIN_NAME,
      version: VERIFICATION_RECEIPT_DOMAIN_VERSION,
      chainId: 968,
      verifyingContract: FIXTURE_VAULT.toLowerCase(),
    });
  });

  it("refuses to build a domain with no deployed contract (honest, never a fake)", () => {
    expect(() => verificationReceiptDomain(readChainConfig({}))).toThrow(/not configured/i);
  });
});

describe("hashVerificationReceipt", () => {
  it("matches the digest fixture the Solidity suite asserts", () => {
    expect(hashVerificationReceipt(FIXTURE_RECEIPT, FIXTURE_CONFIG)).toBe(FIXTURE_DIGEST);
  });

  it("changes when ANY signed field changes", () => {
    const base = hashVerificationReceipt(FIXTURE_RECEIPT, FIXTURE_CONFIG);
    const mutations: Array<[string, VerificationReceipt]> = [
      ["commitmentId", { ...FIXTURE_RECEIPT, commitmentId: 8n }],
      ["goalId", { ...FIXTURE_RECEIPT, goalId: 4n }],
      ["milestoneRef", { ...FIXTURE_RECEIPT, milestoneRef: `0x${"99".repeat(32)}` }],
      ["confidence", { ...FIXTURE_RECEIPT, confidence: 93 }],
      ["evidenceHash", { ...FIXTURE_RECEIPT, evidenceHash: `0x${"99".repeat(32)}` }],
      ["verificationHash", { ...FIXTURE_RECEIPT, verificationHash: `0x${"99".repeat(32)}` }],
      ["modelVersionHash", { ...FIXTURE_RECEIPT, modelVersionHash: `0x${"99".repeat(32)}` }],
      ["deadline", { ...FIXTURE_RECEIPT, deadline: 1_800_000_001n }],
    ];
    for (const [field, mutated] of mutations) {
      expect(hashVerificationReceipt(mutated, FIXTURE_CONFIG), field).not.toBe(base);
    }
  });

  it("is bound to the chain id and the vault address (no cross-deployment replay)", () => {
    const base = hashVerificationReceipt(FIXTURE_RECEIPT, FIXTURE_CONFIG);
    const otherChain = readChainConfig({
      COMMITMENT_VAULT_ADDRESS: FIXTURE_VAULT,
      BOTCHAIN_TESTNET_CHAIN_ID: "969",
    });
    const otherVault = readChainConfig({
      COMMITMENT_VAULT_ADDRESS: VAULT,
      BOTCHAIN_TESTNET_CHAIN_ID: "968",
    });
    expect(hashVerificationReceipt(FIXTURE_RECEIPT, otherChain)).not.toBe(base);
    expect(hashVerificationReceipt(FIXTURE_RECEIPT, otherVault)).not.toBe(base);
  });
});

describe("buildVerificationReceipt", () => {
  it("carries the decision as ids and hashes only", () => {
    expect(sampleReceipt()).toEqual({
      commitmentId: 12n,
      goalId: 4n,
      milestoneRef: milestoneRefFromId("mst_01HZY"),
      confidence: 88,
      evidenceHash: `0x${SHA256}`,
      verificationHash: `0x${OTHER_SHA256}`,
      modelVersionHash: keccak256(toHex("gemini-3.7-flash")),
      deadline: 1_800_000_000n,
    });
  });

  it("zero-fills milestoneRef and evidenceHash when the decision had none", () => {
    const receipt = buildVerificationReceipt({
      commitmentId: 1n,
      goalId: 1n,
      confidence: 100,
      verificationHash: SHA256,
      modelVersion: "gemini-3.7-flash",
      deadline: 1_800_000_000n,
    });
    expect(receipt.milestoneRef).toBe(`0x${"00".repeat(32)}`);
    expect(receipt.evidenceHash).toBe(`0x${"00".repeat(32)}`);
  });

  it("derives milestoneRef the same way registerMilestone anchored it", () => {
    // Both sides must agree or the receipt would describe a milestone the chain never saw.
    expect(sampleReceipt().milestoneRef).toBe(keccak256(toHex("mst_01HZY")));
  });

  it("hashes the model version rather than publishing the string", () => {
    const receipt = sampleReceipt();
    const serialized = JSON.stringify(receipt, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(serialized).not.toContain("gemini");
    expect(receipt.modelVersionHash).toBe(keccak256(toHex("gemini-3.7-flash")));
  });

  it("trims the model version before hashing", () => {
    const spaced = buildVerificationReceipt({
      commitmentId: 1n,
      goalId: 1n,
      confidence: 50,
      verificationHash: SHA256,
      modelVersion: "  gemini-3.7-flash \n",
      deadline: 1_800_000_000n,
    });
    expect(spaced.modelVersionHash).toBe(keccak256(toHex("gemini-3.7-flash")));
  });

  it("rejects every field the contract would revert on, before spending gas", () => {
    const base = {
      commitmentId: 12n,
      goalId: 4n,
      confidence: 88,
      verificationHash: OTHER_SHA256,
      modelVersion: "gemini-3.7-flash",
      deadline: 1_800_000_000n,
    };
    expect(() => buildVerificationReceipt({ ...base, commitmentId: 0n })).toThrow(/commitmentId/);
    expect(() => buildVerificationReceipt({ ...base, goalId: 0n })).toThrow(/goalId/);
    expect(() => buildVerificationReceipt({ ...base, confidence: 101 })).toThrow(/0\.\.100/);
    expect(() => buildVerificationReceipt({ ...base, confidence: -1 })).toThrow(/0\.\.100/);
    expect(() => buildVerificationReceipt({ ...base, confidence: 88.5 })).toThrow(/0\.\.100/);
    expect(() => buildVerificationReceipt({ ...base, deadline: 0n })).toThrow(/deadline/);
    expect(() => buildVerificationReceipt({ ...base, modelVersion: "   " })).toThrow(
      /modelVersion is required/,
    );
    expect(() => buildVerificationReceipt({ ...base, verificationHash: "nope" })).toThrow(
      /32-byte/,
    );
    expect(() => buildVerificationReceipt({ ...base, verificationHash: "0".repeat(64) })).toThrow(
      /non-zero/,
    );
  });
});

describe("receiptDeadline / isReceiptExpired mirror the on-chain check", () => {
  it("adds the ttl to the caller's clock", () => {
    expect(receiptDeadline(1_700_000_000, 900)).toBe(1_700_000_900n);
    expect(receiptDeadline(1_700_000_000n, 900n)).toBe(1_700_000_900n);
    expect(() => receiptDeadline(0, 900)).toThrow(/nowSeconds/);
    expect(() => receiptDeadline(1_700_000_000, 0)).toThrow(/ttlSeconds/);
  });

  it("treats the exact deadline as still valid, and one second later as expired", () => {
    const receipt = sampleReceipt();
    expect(isReceiptExpired(receipt, 1_799_999_999n)).toBe(false);
    expect(isReceiptExpired(receipt, 1_800_000_000n)).toBe(false);
    expect(isReceiptExpired(receipt, 1_800_000_001n)).toBe(true);
  });
});

describe("signing and recovery", () => {
  const signer = getReceiptSigner(config, ANVIL_KEY);

  it("produces a signature that recovers to the verifier address", async () => {
    const receipt = sampleReceipt();
    const signature = await signer.signReceipt(receipt);
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(await recoverVerificationReceiptSigner(receipt, signature, config)).toBe(ANVIL_ADDRESS);
    expect(
      await isValidVerificationReceiptSignature(receipt, signature, ANVIL_ADDRESS, config),
    ).toBe(true);
  });

  it("signs the SAME digest the contract will recompute", async () => {
    const receipt = sampleReceipt();
    const signature = await signer.signReceipt(receipt);
    // Recovering against the typed data spelled out inline proves the signature covers
    // exactly the struct the vault re-derives on-chain, field order included.
    const recovered = await recoverTypedDataAddress({
      domain: verificationReceiptDomain(config),
      types: {
        VerificationReceipt: [
          { name: "commitmentId", type: "uint256" },
          { name: "goalId", type: "uint256" },
          { name: "milestoneRef", type: "bytes32" },
          { name: "confidence", type: "uint16" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "verificationHash", type: "bytes32" },
          { name: "modelVersionHash", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "VerificationReceipt",
      message: receipt,
      signature,
    });
    expect(recovered).toBe(ANVIL_ADDRESS);
    expect(hashVerificationReceipt(receipt, config)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("does not validate for a different expected signer", async () => {
    const receipt = sampleReceipt();
    const signature = await signer.signReceipt(receipt);
    expect(await isValidVerificationReceiptSignature(receipt, signature, VAULT, config)).toBe(
      false,
    );
  });

  it("does not validate once ANY field is tampered with after signing", async () => {
    const receipt = sampleReceipt();
    const signature = await signer.signReceipt(receipt);
    const tampered: VerificationReceipt = { ...receipt, confidence: 99 };
    expect(
      await isValidVerificationReceiptSignature(tampered, signature, ANVIL_ADDRESS, config),
    ).toBe(false);
  });

  it("does not validate for another deployment's domain", async () => {
    const receipt = sampleReceipt();
    const signature = await signer.signReceipt(receipt);
    const elsewhere = readChainConfig({
      COMMITMENT_VAULT_ADDRESS: FIXTURE_VAULT,
      BOTCHAIN_TESTNET_CHAIN_ID: "968",
    });
    expect(
      await isValidVerificationReceiptSignature(receipt, signature, ANVIL_ADDRESS, elsewhere),
    ).toBe(false);
  });

  it("returns false rather than throwing on a malformed signature", async () => {
    const receipt = sampleReceipt();
    expect(
      await isValidVerificationReceiptSignature(receipt, "0x" as Hex, ANVIL_ADDRESS, config),
    ).toBe(false);
    expect(
      await isValidVerificationReceiptSignature(
        receipt,
        `0x${"00".repeat(65)}` as Hex,
        ANVIL_ADDRESS,
        config,
      ),
    ).toBe(false);
  });

  it("exposes the address whose key it holds", () => {
    expect(signer.address).toBe(privateKeyToAccount(ANVIL_KEY).address);
  });
});
