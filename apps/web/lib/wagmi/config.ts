/**
 * wagmi + RainbowKit configuration (build step 9).
 *
 * The WalletConnect project id is a PUBLIC client credential (NEXT_PUBLIC_*),
 * shipped in the browser bundle by design. `ssr: true` lets Next render the tree
 * on the server before a wallet connects. The chain is the real BOT Chain testnet
 * viem chain reused from lib/chain/botchain.ts — one source of truth for chain id,
 * RPC and explorer.
 */
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { botchainTestnet } from "@/lib/chain/botchain";

export const wagmiConfig = getDefaultConfig({
  appName: "CommitAI",
  projectId: process.env["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"] ?? "",
  chains: [botchainTestnet],
  ssr: true,
});
