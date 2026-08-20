import { isAddress } from "viem";
import {
  BOTCHAIN_TESTNET_EXPLORER_URL,
  BOTCHAIN_TESTNET_ID,
  BOTCHAIN_TESTNET_RPC_URL,
} from "./botchain";

/**
 * Chain configuration resolved from the environment (build sequence §14.8).
 *
 * Two honesty rules shape this module (CLAUDE.md rule 1):
 *  - RPC/chain/explorer always resolve (they fall back to the live-verified testnet
 *    defaults), so read-only chain calls work as soon as the RPC is reachable.
 *  - The deployed contract address and the attestor key do NOT have defaults. When
 *    they are unset, the configured-predicates return false and callers report an
 *    honest "not configured" — never a fabricated address, key, or tx.
 *
 * A value that is SET but malformed throws here: a typo in a deploy address or key is
 * a misconfiguration that should fail loudly, not silently degrade to "not configured".
 *
 * The two server-only private keys are deliberately NOT part of `ChainConfig` — they are
 * read only by `readAttestorKey()` / `readAiVerifierKey()` so a logged/serialized config
 * can never leak them. Per CLAUDE.md rule 3 neither key can move funds: the attestor key
 * can only send attestation transactions, and the AI-verifier key can only SIGN — it is
 * never given a wallet client at all. Approval needs both halves (contract invariant I7).
 */

type Env = Record<string, string | undefined>;

export interface ChainConfig {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  /** Deployed `CommitmentVault` address, or null until a real deploy is recorded. */
  readonly vaultAddress: `0x${string}` | null;
}

const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

function parseChainId(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return BOTCHAIN_TESTNET_ID;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`BOTCHAIN_TESTNET_CHAIN_ID must be a positive integer, got "${raw}"`);
  }
  return n;
}

function parseVaultAddress(raw: string | undefined): `0x${string}` | null {
  const v = raw?.trim();
  if (!v) return null;
  if (!HEX_ADDRESS.test(v) || !isAddress(v)) {
    throw new Error(`COMMITMENT_VAULT_ADDRESS is set but not a valid address: "${raw}"`);
  }
  return v.toLowerCase() as `0x${string}`;
}

/** Resolve chain config from the environment (defaults for RPC/chain/explorer). */
export function readChainConfig(env: Env = process.env): ChainConfig {
  const rpcUrl = env["BOTCHAIN_TESTNET_RPC_URL"]?.trim() || BOTCHAIN_TESTNET_RPC_URL;
  const explorerUrl = env["BOTCHAIN_TESTNET_EXPLORER_URL"]?.trim() || BOTCHAIN_TESTNET_EXPLORER_URL;
  return {
    chainId: parseChainId(env["BOTCHAIN_TESTNET_CHAIN_ID"]),
    rpcUrl,
    explorerUrl,
    vaultAddress: parseVaultAddress(env["COMMITMENT_VAULT_ADDRESS"]),
  };
}

/**
 * The attestor private key, validated, or null if unset. Server-only. Read separately
 * from `ChainConfig` so it never rides along in a logged config object.
 */
export function readAttestorKey(env: Env = process.env): `0x${string}` | null {
  const v = env["ATTESTOR_PRIVATE_KEY"]?.trim();
  if (!v) return null;
  if (!HEX_PRIVATE_KEY.test(v)) {
    throw new Error("ATTESTOR_PRIVATE_KEY is set but not a 0x-prefixed 32-byte hex key");
  }
  return v as `0x${string}`;
}

/**
 * The AI-verifier private key, validated, or null if unset. Server-only, and separate
 * from the attestor key on purpose: approving a completion is two-of-two (the attestor
 * sends the transaction, this key signs the EIP-712 verification receipt the contract
 * checks — invariant I7), so one stolen key approves nothing. This key is only ever used
 * to sign a receipt; it is never wrapped in a wallet client and never broadcasts.
 */
export function readAiVerifierKey(env: Env = process.env): `0x${string}` | null {
  const v = env["AI_VERIFIER_PRIVATE_KEY"]?.trim();
  if (!v) return null;
  if (!HEX_PRIVATE_KEY.test(v)) {
    throw new Error("AI_VERIFIER_PRIVATE_KEY is set but not a 0x-prefixed 32-byte hex key");
  }
  return v as `0x${string}`;
}

/**
 * The deployed vault address, or an honest "not configured" throw (CLAUDE.md rule 1 —
 * never a fabricated address). Shared by the contract client and the receipt signer so
 * both fail the same way when no real deploy has been recorded.
 */
export function requireVaultAddress(config: ChainConfig): `0x${string}` {
  if (!config.vaultAddress) {
    throw new Error(
      "chain not configured: COMMITMENT_VAULT_ADDRESS is unset (no deployed contract). " +
        "Deploy the vault and set the address — see README.md / LIMITATIONS.md step 8.",
    );
  }
  return config.vaultAddress;
}

/**
 * The block the vault was deployed in, or null if unset. Used as the default start of a
 * full historical replay (LIMITATIONS.md item 12) so the reconciler does not have to scan
 * the chain from genesis. Kept out of `ChainConfig` because it is an operational hint, not
 * part of the contract identity — a wrong value only makes a replay slower or shorter,
 * never wrong, and callers can always pass an explicit `fromBlock`.
 *
 * Set-but-malformed throws, in line with the rest of this module: a typo'd start block
 * would silently skip real history, which is exactly the bug item 12 exists to fix.
 */
export function readVaultDeploymentBlock(env: Env = process.env): bigint | null {
  const v = env["COMMITMENT_VAULT_DEPLOYMENT_BLOCK"]?.trim();
  if (!v) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(v)) {
    throw new Error(
      `COMMITMENT_VAULT_DEPLOYMENT_BLOCK is set but not a non-negative integer: "${v}"`,
    );
  }
  return BigInt(v);
}

/** True when a deployed contract address is configured (reads/writes can target it). */
export function isChainConfigured(env: Env = process.env): boolean {
  return readChainConfig(env).vaultAddress !== null;
}

/**
 * True when the backend can make attestor calls: a deployed contract AND a valid
 * attestor key. Attesting moves no funds (the contract enforces) — see rule 3.
 */
export function isAttestorConfigured(env: Env = process.env): boolean {
  return isChainConfigured(env) && readAttestorKey(env) !== null;
}

/**
 * True when the backend can APPROVE a completion end-to-end: a deployed contract plus
 * BOTH halves of the two-of-two — the attestor key that sends the transaction and the
 * distinct AI-verifier key that signs the receipt. With only one of them, attesting a
 * milestone still works; approving does not (the contract rejects it).
 */
export function isApprovalConfigured(env: Env = process.env): boolean {
  return isAttestorConfigured(env) && readAiVerifierKey(env) !== null;
}
