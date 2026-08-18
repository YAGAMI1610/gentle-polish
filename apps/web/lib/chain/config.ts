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
 * The attestor private key is deliberately NOT part of `ChainConfig` — it is read only
 * by `readAttestorKey()` (server-side, in `contractClient.ts`) so a logged/serialized
 * config can never leak it. Per CLAUDE.md rule 3 this key can only attest; the contract
 * gives it no path to move funds.
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
