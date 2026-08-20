import {
  hashTypedData,
  keccak256,
  recoverTypedDataAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  readAiVerifierKey,
  readChainConfig,
  requireVaultAddress,
  type ChainConfig,
} from "./config";
import { hashToBytes32, milestoneRefFromId } from "./contractClient";

/**
 * Signed verification receipts — the off-chain half of the two-of-two approval
 * (LIMITATIONS.md §19.1 production fix, item 11).
 *
 * `CommitmentVault.approveCompletion` no longer takes a bare confidence number. It takes
 * an EIP-712 `VerificationReceipt` plus a signature from the contract's `aiVerifier`, and
 * rejects the call unless the signature covers the exact decision being written: which
 * commitment, which goal, which milestone, what confidence, which evidence hash, which
 * §6.5 verification hash, and which model version decided it. So an approval on-chain is
 * cryptographically bound to one specific AI decision, and a stolen attestor key can no
 * longer invent a confidence value — invariant I7.
 *
 * This module builds, hashes, signs and verifies those receipts, and is the ONLY place
 * the AI-verifier key is used. Note what the signer is deliberately NOT given: no wallet
 * client, no RPC transport, no `writeContract`. It can produce a signature and nothing
 * else (CLAUDE.md rules 2–3) — asserted in `receipt.safety.test.ts`.
 *
 * PRIVACY (§9/§10, item 13): a receipt carries only ids and hashes. No evidence bytes,
 * no evidence text, no model prose ever enters it, so anchoring one publishes nothing
 * about the user's evidence that was not already a hash.
 *
 * Purity: the caller supplies `deadline` (as `verificationHash.ts` supplies `timestamp`)
 * rather than this module reading the clock, so a receipt is reproducible in tests and
 * the exact expiry that was signed is explicit in the audit trail.
 */

/** EIP-712 domain name — must match `EIP712("CommitAI CommitmentVault", "1")` in the vault. */
export const VERIFICATION_RECEIPT_DOMAIN_NAME = "CommitAI CommitmentVault";
export const VERIFICATION_RECEIPT_DOMAIN_VERSION = "1";

/**
 * Canonical EIP-712 type string. Byte-for-byte the string the contract hashes into
 * `VERIFICATION_RECEIPT_TYPEHASH` — field order included, since the struct hash is the
 * preimage both sides must agree on.
 */
export const VERIFICATION_RECEIPT_TYPE_STRING =
  "VerificationReceipt(uint256 commitmentId,uint256 goalId,bytes32 milestoneRef," +
  "uint16 confidence,bytes32 evidenceHash,bytes32 verificationHash," +
  "bytes32 modelVersionHash,uint256 deadline)";

/** keccak256 of the type string — equals the contract's public typehash constant. */
export const VERIFICATION_RECEIPT_TYPEHASH = keccak256(toHex(VERIFICATION_RECEIPT_TYPE_STRING));

/** The typed-data field list, in the same order as the Solidity struct. */
export const VERIFICATION_RECEIPT_TYPES = {
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
} as const;

const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

/** The exact tuple `approveCompletion` takes. All hashes, no content. */
export interface VerificationReceipt {
  /** Pins the receipt to one commitment (anti-replay). */
  readonly commitmentId: bigint;
  /** Must equal that commitment's goal on-chain, or the contract reverts. */
  readonly goalId: bigint;
  /** Opaque on-chain ref for the milestone, or zero when the receipt covers the goal. */
  readonly milestoneRef: Hex;
  /** The confidence to be written; the contract re-checks it against the threshold. */
  readonly confidence: number;
  /** sha256 of the off-chain evidence — never the evidence. Zero when there is none. */
  readonly evidenceHash: Hex;
  /** The §6.5 decision digest being anchored. Must be non-zero. */
  readonly verificationHash: Hex;
  /** keccak256 of the deciding model's version string. Must be non-zero. */
  readonly modelVersionHash: Hex;
  /** Unix seconds. A stale decision stops being submittable; zero is already expired. */
  readonly deadline: bigint;
}

export interface BuildVerificationReceiptInput {
  readonly commitmentId: bigint;
  readonly goalId: bigint;
  /** Off-chain milestone id, hashed to the same ref `registerMilestone` anchors. */
  readonly milestoneId?: string | null;
  readonly confidence: number;
  /** sha256 hex of the evidence (64 hex chars), or null when the decision had none. */
  readonly evidenceHash?: string | null;
  /** The §6.5 verification hash (`computeVerificationHash`), 64 hex chars. */
  readonly verificationHash: string;
  /** The model id/version that produced the decision, e.g. "gemini-3.7-flash". */
  readonly modelVersion: string;
  /** Unix seconds after which the receipt is refused on-chain. Caller-supplied clock. */
  readonly deadline: bigint;
}

/**
 * Build a receipt from the decision the backend actually made, validating every field
 * the contract would reject anyway — so a bad receipt fails here, loudly and for free,
 * instead of costing a reverted transaction.
 */
export function buildVerificationReceipt(
  input: BuildVerificationReceiptInput,
): VerificationReceipt {
  if (input.commitmentId <= 0n) {
    throw new Error("verification receipt: commitmentId must be a positive on-chain id");
  }
  if (input.goalId <= 0n) {
    throw new Error("verification receipt: goalId must be a positive on-chain id");
  }
  if (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100) {
    throw new Error(
      `verification receipt: confidence must be an integer 0..100, got ${input.confidence}`,
    );
  }
  if (input.deadline <= 0n) {
    throw new Error("verification receipt: deadline must be a positive unix timestamp");
  }
  const modelVersion = input.modelVersion.trim();
  if (modelVersion === "") {
    // The contract rejects a zero modelVersionHash: "which model decided this" is what
    // makes the approval auditable rather than merely signed.
    throw new Error("verification receipt: modelVersion is required (the contract rejects zero)");
  }
  const verificationHash = hashToBytes32(input.verificationHash);
  if (verificationHash === ZERO_BYTES32) {
    throw new Error("verification receipt: verificationHash must be non-zero");
  }
  return {
    commitmentId: input.commitmentId,
    goalId: input.goalId,
    milestoneRef: input.milestoneId ? milestoneRefFromId(input.milestoneId) : ZERO_BYTES32,
    confidence: input.confidence,
    evidenceHash: input.evidenceHash ? hashToBytes32(input.evidenceHash) : ZERO_BYTES32,
    verificationHash,
    modelVersionHash: keccak256(toHex(modelVersion)),
    deadline: input.deadline,
  };
}

/** `nowSeconds + ttlSeconds` as a receipt deadline. The clock stays with the caller. */
export function receiptDeadline(nowSeconds: number | bigint, ttlSeconds: number | bigint): bigint {
  const now = BigInt(nowSeconds);
  const ttl = BigInt(ttlSeconds);
  if (now <= 0n) throw new Error("receiptDeadline: nowSeconds must be positive");
  if (ttl <= 0n) throw new Error("receiptDeadline: ttlSeconds must be positive");
  return now + ttl;
}

export interface VerificationReceiptDomain {
  readonly name: string;
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
}

/**
 * The EIP-712 domain. Chain id and the deployed vault address are part of it, so a
 * receipt signed for this deployment is meaningless on any other chain or contract.
 * Throws honestly when no real deploy is configured (rule 1).
 */
export function verificationReceiptDomain(
  config: ChainConfig = readChainConfig(),
): VerificationReceiptDomain {
  return {
    name: VERIFICATION_RECEIPT_DOMAIN_NAME,
    version: VERIFICATION_RECEIPT_DOMAIN_VERSION,
    chainId: config.chainId,
    verifyingContract: requireVaultAddress(config),
  };
}

/**
 * The digest the vault's `hashVerificationReceipt` returns — recomputed locally, with no
 * network call. `receipt.test.ts` pins it against a fixture the Solidity suite asserts
 * too, so a drift in either implementation fails a test instead of mis-signing on-chain.
 */
export function hashVerificationReceipt(
  receipt: VerificationReceipt,
  config: ChainConfig = readChainConfig(),
): Hex {
  return hashTypedData({
    domain: verificationReceiptDomain(config),
    types: VERIFICATION_RECEIPT_TYPES,
    primaryType: "VerificationReceipt",
    message: receipt,
  });
}

/** Recover the address that signed a receipt (used to prove which key vouched). */
export async function recoverVerificationReceiptSigner(
  receipt: VerificationReceipt,
  signature: Hex,
  config: ChainConfig = readChainConfig(),
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: verificationReceiptDomain(config),
    types: VERIFICATION_RECEIPT_TYPES,
    primaryType: "VerificationReceipt",
    message: receipt,
    signature,
  });
}

/**
 * Does `signature` cover this exact receipt, from `expectedSigner`? The same check the
 * contract makes for EOA signers, so the backend can refuse before spending gas.
 * (On-chain, `SignatureChecker` additionally accepts an ERC-1271 contract signer — a
 * multisig verifier — which cannot be validated off-chain without an RPC call.)
 */
export async function isValidVerificationReceiptSignature(
  receipt: VerificationReceipt,
  signature: Hex,
  expectedSigner: Address,
  config: ChainConfig = readChainConfig(),
): Promise<boolean> {
  try {
    const recovered = await recoverVerificationReceiptSigner(receipt, signature, config);
    return recovered.toLowerCase() === expectedSigner.toLowerCase();
  } catch {
    // Malformed signature — not a match, and not an exception for the caller to handle.
    return false;
  }
}

/** Mirror of the contract's staleness check, so a stale receipt never costs gas. */
export function isReceiptExpired(
  receipt: VerificationReceipt,
  nowSeconds: number | bigint,
): boolean {
  return receipt.deadline < BigInt(nowSeconds);
}

/**
 * The AI verifier's capability set: an address, and the ability to sign a receipt.
 * Deliberately NOTHING else — no wallet client, no transport, no contract write. Frozen,
 * so nothing can bolt a broadcast method on at runtime.
 */
export interface ReceiptSigner {
  /** The address the contract must have configured as `aiVerifier()`. */
  readonly address: Address;
  signReceipt(receipt: VerificationReceipt): Promise<Hex>;
}

/**
 * Build the receipt signer from `AI_VERIFIER_PRIVATE_KEY`. Throws an honest error when
 * the key or the deployed contract is missing (never a fake signature).
 */
export function getReceiptSigner(
  config: ChainConfig = readChainConfig(),
  key: `0x${string}` | null = readAiVerifierKey(),
): ReceiptSigner {
  if (!key) {
    throw new Error(
      "AI verifier not configured: AI_VERIFIER_PRIVATE_KEY is unset. Completions cannot be " +
        "approved until it is set — the contract requires a signed verification receipt " +
        "(invariant I7). This key can only sign; it can never move funds. See LIMITATIONS.md.",
    );
  }
  const domain = verificationReceiptDomain(config);
  const account = privateKeyToAccount(key);
  return Object.freeze<ReceiptSigner>({
    address: account.address,
    signReceipt: (receipt) =>
      account.signTypedData({
        domain,
        types: VERIFICATION_RECEIPT_TYPES,
        primaryType: "VerificationReceipt",
        message: receipt,
      }),
  });
}
