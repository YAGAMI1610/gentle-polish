import { afterEach, describe, expect, it, vi } from "vitest";

import { BOTCHAIN_TESTNET_ID } from "@/lib/chain/botchain";

/**
 * Regression guard for the production build crash fixed in lib/wagmi/config.ts.
 *
 * RainbowKit's `getDefaultConfig` always includes the WalletConnect wallet, whose
 * connector throws "No projectId found" the instant the projectId is empty. Because
 * the config is built at module load and imported by the root providers, that throw
 * crashed the static prerender of every page (including /_not-found) and failed
 * `next build` whenever NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID was unset — exactly the
 * state of a fresh Vercel project (reproduced locally before the fix).
 *
 * This test pins the honest-gating BRANCH: an empty projectId must route to the
 * injected-only fallback (createConfig + connectorsForWallets(injectedWallet)) and
 * must NOT touch getDefaultConfig/WalletConnect; a present projectId must route to
 * getDefaultConfig. The heavy wallet libraries are mocked — importing the real
 * wagmi/RainbowKit graph costs ~25s, and we only need to observe which builder is
 * chosen. The end-to-end proof that the chosen config actually builds without
 * throwing is the `next build` run against an empty projectId.
 */

const KEY = "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID";
// A real, PUBLIC WalletConnect projectId (client-exposed by design), matching the one
// shipped in apps/web/.env. Only used to exercise the "configured" branch.
const PUBLIC_PROJECT_ID = "6fcf0f743e38ea5bfeacd278ea19e080";

const mocks = vi.hoisted(() => ({
  getDefaultConfig: vi.fn((args: { projectId: string; chains: readonly unknown[] }) => ({
    builder: "getDefaultConfig" as const,
    ...args,
  })),
  connectorsForWallets: vi.fn((walletList: ReadonlyArray<{ wallets: readonly unknown[] }>) =>
    walletList.flatMap((group) => [...group.wallets]),
  ),
  createConfig: vi.fn((args: { chains: readonly unknown[]; connectors: readonly unknown[] }) => ({
    builder: "createConfig" as const,
    ...args,
  })),
  http: vi.fn(() => ({ transport: "http" as const })),
  injectedWallet: { walletId: "injectedWallet-mock" as const },
}));

vi.mock("@rainbow-me/rainbowkit", () => ({
  getDefaultConfig: mocks.getDefaultConfig,
  connectorsForWallets: mocks.connectorsForWallets,
}));
vi.mock("@rainbow-me/rainbowkit/wallets", () => ({ injectedWallet: mocks.injectedWallet }));
vi.mock("wagmi", () => ({ createConfig: mocks.createConfig, http: mocks.http }));

/** Re-evaluate lib/wagmi/config.ts fresh under the given projectId env. */
async function loadWith(projectId: string) {
  vi.resetModules();
  for (const m of [
    mocks.getDefaultConfig,
    mocks.connectorsForWallets,
    mocks.createConfig,
    mocks.http,
  ]) {
    m.mockClear();
  }
  vi.stubEnv(KEY, projectId);
  const mod = await import("@/lib/wagmi/config");
  vi.unstubAllEnvs();
  return mod;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("wagmi config — WalletConnect honest-gating (build-crash regression)", () => {
  it("with an EMPTY projectId: never touches getDefaultConfig/WalletConnect (the crash path)", async () => {
    const mod = await loadWith("");

    expect(mod.isWalletConnectConfigured).toBe(false);
    // The WalletConnect-bearing builder is exactly what threw on Vercel — it must not run.
    expect(mocks.getDefaultConfig).not.toHaveBeenCalled();
    // Instead we build a real config from the injected wallet, which needs no projectId.
    expect(mocks.createConfig).toHaveBeenCalledTimes(1);
    expect(mocks.connectorsForWallets).toHaveBeenCalledTimes(1);
    expect(mocks.connectorsForWallets).toHaveBeenCalledWith(
      [{ groupName: "Installed", wallets: [mocks.injectedWallet] }],
      expect.objectContaining({ projectId: "" }),
    );
    // And the config carries the real BOT Chain testnet, not some placeholder.
    const created = mocks.createConfig.mock.results[0]?.value as { chains: { id: number }[] };
    expect(created.chains.map((c) => c.id)).toContain(BOTCHAIN_TESTNET_ID);
    expect(mod.wagmiConfig).toBeDefined();
  });

  it("with a PRESENT projectId: uses getDefaultConfig (full wallet list) and no fallback", async () => {
    const mod = await loadWith(PUBLIC_PROJECT_ID);

    expect(mod.isWalletConnectConfigured).toBe(true);
    expect(mocks.getDefaultConfig).toHaveBeenCalledTimes(1);
    expect(mocks.getDefaultConfig).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PUBLIC_PROJECT_ID }),
    );
    expect(mocks.createConfig).not.toHaveBeenCalled();
    expect(mocks.connectorsForWallets).not.toHaveBeenCalled();
    expect(mod.wagmiConfig).toBeDefined();
  });

  it("treats a whitespace-free empty string as unconfigured (no accidental truthiness)", async () => {
    const mod = await loadWith("");
    expect(mod.isWalletConnectConfigured).toBe(false);
  });
});
