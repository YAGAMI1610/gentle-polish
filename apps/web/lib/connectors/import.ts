import type { Evidence } from "@prisma/client";
import { getConnectorToken } from "@/lib/db";
import { storeEvidence } from "@/lib/evidence/storeEvidence";
import {
  fetchGithubEvents,
  fetchGithubLogin,
  summarizeGithubEvents,
  summaryToEvidenceText,
} from "./github";

/**
 * Import a wallet's recent GitHub activity as one off-chain `Evidence(type: GITHUB)`
 * row (LIMITATIONS item 8).
 *
 * The impure boundaries (stored-token lookup, the two GitHub reads, evidence write)
 * are injected — the same DI seam as `onchainBackfill` — so the control flow
 * (not-connected → honest error, activity → deterministic evidence text) is tested
 * always-on with in-test doubles, no DB or network. The fetched activity is
 * UNTRUSTED (rule 5): it is summarised and hashed, never interpreted as
 * instructions, and only its sha256 is ever eligible for on-chain anchoring.
 */

/** Thrown when an import is attempted for a wallet that hasn't linked GitHub. */
export class ConnectorNotConnectedError extends Error {
  constructor(message = "github is not connected for this wallet") {
    super(message);
    this.name = "ConnectorNotConnectedError";
  }
}

export interface GithubImportArgs {
  readonly goalId: string;
  readonly checkInId?: string;
  /** Optional ISO instant — only activity at/after this is summarised. */
  readonly since?: string;
}

export interface GithubImportDeps {
  getToken: (walletAddress: string) => Promise<string | null>;
  fetchLogin: (accessToken: string) => Promise<string>;
  fetchEvents: (accessToken: string, login: string) => Promise<unknown[]>;
  store: (
    walletAddress: string,
    args: {
      goalId: string;
      type: "GITHUB";
      contentText: string;
      checkInId?: string;
    },
  ) => Promise<Evidence>;
}

/** Production wiring: the real token lookup, GitHub reads, and evidence writer. */
export const defaultGithubImportDeps: GithubImportDeps = {
  getToken: (wallet) => getConnectorToken(wallet, "GITHUB"),
  fetchLogin: (token) => fetchGithubLogin(token),
  fetchEvents: (token, login) => fetchGithubEvents(token, login),
  store: (wallet, args) => storeEvidence(wallet, args),
};

export async function importGithubActivity(
  walletAddress: string,
  args: GithubImportArgs,
  deps: GithubImportDeps = defaultGithubImportDeps,
): Promise<Evidence> {
  const token = await deps.getToken(walletAddress);
  if (!token) {
    throw new ConnectorNotConnectedError();
  }
  const login = await deps.fetchLogin(token);
  const events = await deps.fetchEvents(token, login);
  const summary = summarizeGithubEvents(events, {
    login,
    ...(args.since !== undefined ? { since: args.since } : {}),
  });
  const contentText = summaryToEvidenceText(summary);
  return deps.store(walletAddress, {
    goalId: args.goalId,
    type: "GITHUB",
    contentText,
    ...(args.checkInId !== undefined ? { checkInId: args.checkInId } : {}),
  });
}
