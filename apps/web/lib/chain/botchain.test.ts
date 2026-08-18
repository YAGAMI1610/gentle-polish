import { describe, expect, it } from "vitest";
import {
  BOTCHAIN_TESTNET_EXPLORER_URL,
  BOTCHAIN_TESTNET_ID,
  BOTCHAIN_TESTNET_RPC_URL,
  botchainTestnet,
  buildBotchainTestnet,
  explorerAddressUrl,
  explorerTxUrl,
} from "./botchain";

/**
 * BOT Chain testnet parameters (build step 8). The chain id is the live-verified
 * value (`eth_chainId → 0x3c8 → 968`); the explorer helpers replace the old
 * non-resolving `.test` URL noted in LIMITATIONS §2.
 */

describe("botchain testnet params", () => {
  it("uses the live-verified chain id 968", () => {
    expect(BOTCHAIN_TESTNET_ID).toBe(968);
  });

  it("builds a viem chain with BOT native currency and testnet flag", () => {
    const chain = buildBotchainTestnet({
      chainId: BOTCHAIN_TESTNET_ID,
      rpcUrl: BOTCHAIN_TESTNET_RPC_URL,
      explorerUrl: BOTCHAIN_TESTNET_EXPLORER_URL,
    });
    expect(chain.id).toBe(968);
    expect(chain.nativeCurrency).toEqual({ name: "BOT", symbol: "BOT", decimals: 18 });
    expect(chain.rpcUrls.default.http[0]).toBe(BOTCHAIN_TESTNET_RPC_URL);
    expect(chain.testnet).toBe(true);
    expect(botchainTestnet.id).toBe(968);
  });
});

describe("explorer URL helpers", () => {
  it("builds tx and address URLs against the default explorer", () => {
    expect(explorerTxUrl("0xabc")).toBe("https://scan.bohr.life/tx/0xabc");
    expect(explorerAddressUrl("0xdef")).toBe("https://scan.bohr.life/address/0xdef");
  });

  it("normalizes a trailing slash on a custom explorer base", () => {
    expect(explorerTxUrl("0xabc", "https://example.io/")).toBe("https://example.io/tx/0xabc");
    expect(explorerAddressUrl("0xdef", "https://example.io///")).toBe(
      "https://example.io/address/0xdef",
    );
  });
});
