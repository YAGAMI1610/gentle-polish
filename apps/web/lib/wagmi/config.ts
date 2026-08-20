/**
 * wagmi + RainbowKit configuration (build step 9).
 *
 * The WalletConnect project id is a PUBLIC client credential (NEXT_PUBLIC_*),
 * shipped in the browser bundle by design. `ssr: true` lets Next render the tree
 * on the server before a wallet connects. The chain is the real BOT Chain testnet
 * viem chain reused from lib/chain/botchain.ts — one source of truth for chain id,
 * RPC and explorer.
 *
 * Honest-gating (CLAUDE.md rule 6): RainbowKit's `getDefaultConfig` always pulls in
 * the WalletConnect wallet, whose connector throws "No projectId found" the instant
 * the projectId is empty (see @rainbow-me/rainbowkit `getWalletConnectConnector`).
 * Because this config is built at module load and imported by the root providers,
 * an empty projectId crashes EVERY server render — including the static prerender of
 * /_not-found — and fails the whole production build. Making one optional public
 * credential a hard build dependency is unacceptable fragility.
 *
 * So we branch. WITH a projectId: `getDefaultConfig` unchanged — the full wallet list
 * incl. WalletConnect (the production path). WITHOUT one: a real, still-functional
 * config offering the injected (browser-extension) connector only; WalletConnect is
 * honestly unavailable until the id is set. Nothing here is faked — the fallback is a
 * genuine RainbowKit `injectedWallet`, not a stub. See LIMITATIONS.md (WalletConnect
 * gating note) for how to enable the full wallet list in production.
 */
import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, type Config } from "wagmi";

import { botchainTestnet } from "@/lib/chain/botchain";

const appName = "CommitAI";
const walletConnectProjectId = process.env["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"] ?? "";

/**
 * True only when a real WalletConnect projectId is configured. Exposed so UI/tests
 * can tell whether the full wallet list (incl. WalletConnect) or the injected-only
 * fallback is active. See the honest-gating note above.
 */
export const isWalletConnectConfigured = walletConnectProjectId !== "";

export const wagmiConfig: Config = isWalletConnectConfigured
  ? getDefaultConfig({
      appName,
      projectId: walletConnectProjectId,
      chains: [botchainTestnet],
      ssr: true,
    })
  : createConfig({
      chains: [botchainTestnet],
      // injectedWallet needs no projectId, so this never hits the WalletConnect
      // throw above. It surfaces whatever browser-extension wallet is installed
      // (MetaMask, Brave, Rabby, …), which is the common desktop case.
      connectors: connectorsForWallets([{ groupName: "Installed", wallets: [injectedWallet] }], {
        appName,
        projectId: walletConnectProjectId,
      }),
      transports: { [botchainTestnet.id]: http() },
      ssr: true,
    });
