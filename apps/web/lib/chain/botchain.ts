import { defineChain } from "viem";

/**
 * BOT Chain testnet — the chain CommitAI deploys to (build sequence §14.8, §1).
 *
 * Live-verified parameters (reachable from this environment): chain id 968
 * (`eth_chainId → 0x3c8`), RPC `https://rpc.bohr.life`, explorer
 * `https://scan.bohr.life`, faucet `https://faucet.botchain.ai/basic`.
 *
 * These are the DEFAULTS; the real values are read from env in `config.ts` so a
 * deployment can point at a different RPC/explorer without a code change. This
 * module is pure — it holds no env access and no client — so it is trivially
 * testable and safe to import anywhere.
 */

export const BOTCHAIN_TESTNET_ID = 968;
export const BOTCHAIN_TESTNET_RPC_URL = "https://rpc.bohr.life";
export const BOTCHAIN_TESTNET_EXPLORER_URL = "https://scan.bohr.life";
export const BOTCHAIN_TESTNET_FAUCET_URL = "https://faucet.botchain.ai/basic";

export interface BotchainParams {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
}

/** Build the viem `Chain` for BOT Chain testnet from resolved params. */
export function buildBotchainTestnet(params: BotchainParams) {
  return defineChain({
    id: params.chainId,
    name: "BOT Chain Testnet",
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [params.rpcUrl] } },
    blockExplorers: { default: { name: "BOT Chain Explorer", url: params.explorerUrl } },
    testnet: true,
  });
}

/** The default chain object (baked-in testnet params); env overrides live in `config.ts`. */
export const botchainTestnet = buildBotchainTestnet({
  chainId: BOTCHAIN_TESTNET_ID,
  rpcUrl: BOTCHAIN_TESTNET_RPC_URL,
  explorerUrl: BOTCHAIN_TESTNET_EXPLORER_URL,
});

/** Trim a trailing slash so URL joins never double up. */
function normalizeBase(explorerUrl: string): string {
  return explorerUrl.replace(/\/+$/, "");
}

/** Explorer link for a transaction hash. Replaces the old non-resolving `.test` URL. */
export function explorerTxUrl(
  txHash: string,
  explorerUrl: string = BOTCHAIN_TESTNET_EXPLORER_URL,
): string {
  return `${normalizeBase(explorerUrl)}/tx/${txHash}`;
}

/** Explorer link for an address. */
export function explorerAddressUrl(
  address: string,
  explorerUrl: string = BOTCHAIN_TESTNET_EXPLORER_URL,
): string {
  return `${normalizeBase(explorerUrl)}/address/${address}`;
}
