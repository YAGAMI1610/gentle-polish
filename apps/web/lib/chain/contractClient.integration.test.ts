import { describe, expect, it } from "vitest";
import { BOTCHAIN_TESTNET_ID } from "./botchain";
import { isChainConfigured, readChainConfig } from "./config";
import { getChainId, readCommitmentStatus } from "./contractClient";

/**
 * Live BOT Chain testnet reads (build step 8). Two INDEPENDENT gates, and no fakes
 * (CLAUDE.md rule 1) — a skipped read prints why; a running read hits the real chain:
 *
 *  1. RPC-reachability gate. We actually dial the configured RPC and read its chain
 *     id. If the network is unreachable from the test host the block skips with a
 *     printed reason; when it runs it asserts the REAL id is BOT Chain testnet's 968,
 *     proving the client talks to the real chain even before a contract is deployed.
 *  2. Deployed-contract gate. A real `getCommitmentStatus` read only runs once
 *     COMMITMENT_VAULT_ADDRESS points at a deployed vault. Until the user's local
 *     deploy step it skips with an instruction — never a placeholder address or a
 *     fabricated read.
 */

async function probeChainId(): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getChainId(readChainConfig()),
      // Generous: a cold TLS handshake to the public testnet RPC can take several
      // seconds. Too tight a bound would misclassify a working RPC as unreachable and
      // silently skip the live assertion; this errs toward actually exercising it.
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 12_000);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const liveChainId = await probeChainId();
if (liveChainId === null) {
  console.info(
    "[contractClient.integration] live RPC read SKIPPED — BOT Chain testnet RPC unreachable from this host.",
  );
}

describe.skipIf(liveChainId === null)("live BOT Chain testnet RPC", () => {
  it("reads the real chain id 968 from the configured RPC", () => {
    expect(liveChainId).toBe(BOTCHAIN_TESTNET_ID);
    expect(liveChainId).toBe(968);
  });
});

const vaultReady = isChainConfigured();
if (!vaultReady) {
  console.info(
    "[contractClient.integration] on-chain contract read SKIPPED — COMMITMENT_VAULT_ADDRESS unset " +
      "(no deployed vault). Deploy per README.md step 8, set the address, then re-run to exercise it.",
  );
}

describe.skipIf(!vaultReady)("live CommitmentVault read", () => {
  it("reads a numeric commitment status from the deployed vault (moves nothing)", async () => {
    // Whether or not commitment #1 exists, the call must reach a real contract and
    // return a numeric status byte — a pure view call that transfers no value.
    const status = await readCommitmentStatus(1n, readChainConfig());
    expect(typeof status).toBe("number");
    expect(status).toBeGreaterThanOrEqual(0);
  }, 15_000);
});
