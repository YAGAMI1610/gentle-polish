import { describe, expect, it } from "vitest";
import {
  BOTCHAIN_TESTNET_EXPLORER_URL,
  BOTCHAIN_TESTNET_ID,
  BOTCHAIN_TESTNET_RPC_URL,
} from "./botchain";
import {
  isAttestorConfigured,
  isChainConfigured,
  readAttestorKey,
  readChainConfig,
} from "./config";

/**
 * Chain config resolution (build step 8). The honesty rules (CLAUDE.md rule 1):
 * RPC/chain/explorer fall back to the live-verified testnet defaults so reads work
 * as soon as the RPC is reachable, but the deployed vault address and attestor key
 * have NO defaults — unset → not-configured, set-but-malformed → throws (a typo is
 * a misconfiguration, not a silent degrade). All functions take an explicit env so
 * these never touch `process.env`.
 */

const VAULT = "0x1111111111111111111111111111111111111111";
// Well-known anvil test account #0 — a PUBLIC throwaway key, never a real secret.
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("readChainConfig", () => {
  it("falls back to the live-verified testnet defaults, vault null", () => {
    const cfg = readChainConfig({});
    expect(cfg.chainId).toBe(BOTCHAIN_TESTNET_ID);
    expect(cfg.rpcUrl).toBe(BOTCHAIN_TESTNET_RPC_URL);
    expect(cfg.explorerUrl).toBe(BOTCHAIN_TESTNET_EXPLORER_URL);
    expect(cfg.vaultAddress).toBeNull();
  });

  it("reads and lowercases a valid vault address", () => {
    const cfg = readChainConfig({
      COMMITMENT_VAULT_ADDRESS: VAULT.toUpperCase().replace("0X", "0x"),
    });
    expect(cfg.vaultAddress).toBe(VAULT);
  });

  it("parses a custom chain id and overrides RPC/explorer", () => {
    const cfg = readChainConfig({
      BOTCHAIN_TESTNET_CHAIN_ID: "4242",
      BOTCHAIN_TESTNET_RPC_URL: "https://rpc.example.io",
      BOTCHAIN_TESTNET_EXPLORER_URL: "https://scan.example.io",
    });
    expect(cfg.chainId).toBe(4242);
    expect(cfg.rpcUrl).toBe("https://rpc.example.io");
    expect(cfg.explorerUrl).toBe("https://scan.example.io");
  });

  it("throws on a malformed chain id", () => {
    expect(() => readChainConfig({ BOTCHAIN_TESTNET_CHAIN_ID: "not-a-number" })).toThrow();
  });

  it("throws on a set-but-invalid vault address (no silent degrade)", () => {
    expect(() => readChainConfig({ COMMITMENT_VAULT_ADDRESS: "0xnope" })).toThrow();
  });
});

describe("readAttestorKey", () => {
  it("returns null when unset", () => {
    expect(readAttestorKey({})).toBeNull();
  });

  it("returns a valid key", () => {
    expect(readAttestorKey({ ATTESTOR_PRIVATE_KEY: ANVIL_KEY })).toBe(ANVIL_KEY);
  });

  it("throws on a malformed key rather than degrading", () => {
    expect(() => readAttestorKey({ ATTESTOR_PRIVATE_KEY: "0x1234" })).toThrow();
  });
});

describe("configured predicates", () => {
  it("isChainConfigured tracks a deployed vault address", () => {
    expect(isChainConfigured({})).toBe(false);
    expect(isChainConfigured({ COMMITMENT_VAULT_ADDRESS: VAULT })).toBe(true);
  });

  it("isAttestorConfigured requires BOTH a deployed vault and a valid key", () => {
    expect(isAttestorConfigured({})).toBe(false);
    expect(isAttestorConfigured({ COMMITMENT_VAULT_ADDRESS: VAULT })).toBe(false);
    expect(isAttestorConfigured({ ATTESTOR_PRIVATE_KEY: ANVIL_KEY })).toBe(false);
    expect(
      isAttestorConfigured({ COMMITMENT_VAULT_ADDRESS: VAULT, ATTESTOR_PRIVATE_KEY: ANVIL_KEY }),
    ).toBe(true);
  });
});
