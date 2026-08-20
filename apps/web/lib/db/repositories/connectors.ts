import type { ConnectorProvider, EvidenceConnector } from "@prisma/client";
import { prisma } from "../client";
import { evmAddressSchema } from "../schemas";
import { ensureWallet } from "./wallet";
import { decryptSecret, deriveConnectorKey, encryptSecret } from "@/lib/connectors/crypto";

/**
 * Wallet-scoped evidence-connector persistence (LIMITATIONS item 8).
 *
 * Every query folds the authenticated `walletAddress` into its `where`, so a
 * connection is only ever visible to the wallet that created it (§9/§10) — a
 * cross-wallet read returns null. The OAuth access token is encrypted before it
 * ever touches the row (`encryptSecret`) and decrypted only by `getConnectorToken`
 * at the moment an import needs it; the status-returning functions NEVER expose the
 * token. Storing a token moves no funds (CLAUDE.md rules 2–3): it only lets the
 * owner read their own GitHub activity into off-chain evidence.
 */

/** Connection status safe to return to a client — no token material. */
export interface ConnectorStatus {
  readonly provider: ConnectorProvider;
  readonly externalLogin: string;
  readonly scope: string;
  readonly connectedAt: Date;
}

function toStatus(row: EvidenceConnector): ConnectorStatus {
  return {
    provider: row.provider,
    externalLogin: row.externalLogin,
    scope: row.scope,
    connectedAt: row.createdAt,
  };
}

export interface UpsertConnectorInput {
  readonly provider: ConnectorProvider;
  readonly externalLogin: string;
  /** Plaintext OAuth access token — encrypted here, never stored raw. */
  readonly accessToken: string;
  readonly scope: string;
}

/**
 * Create or replace the wallet's connection for a provider. Idempotent on the
 * (wallet, provider) unique key: re-connecting updates the login/token/scope in
 * place rather than accumulating rows. Returns the (tokenless) status.
 */
export async function upsertConnector(
  walletAddress: string,
  input: UpsertConnectorInput,
): Promise<ConnectorStatus> {
  const wallet = evmAddressSchema.parse(walletAddress);
  await ensureWallet(wallet);
  const accessTokenEnc = encryptSecret(input.accessToken, deriveConnectorKey());

  const row = await prisma.evidenceConnector.upsert({
    where: { walletAddress_provider: { walletAddress: wallet, provider: input.provider } },
    create: {
      walletAddress: wallet,
      provider: input.provider,
      externalLogin: input.externalLogin,
      accessTokenEnc,
      scope: input.scope,
    },
    update: {
      externalLogin: input.externalLogin,
      accessTokenEnc,
      scope: input.scope,
    },
  });
  return toStatus(row);
}

/** The wallet's status for one provider, or null if not connected. Never a token. */
export async function getConnectorStatus(
  walletAddress: string,
  provider: ConnectorProvider,
): Promise<ConnectorStatus | null> {
  const wallet = evmAddressSchema.parse(walletAddress);
  const row = await prisma.evidenceConnector.findUnique({
    where: { walletAddress_provider: { walletAddress: wallet, provider } },
  });
  return row ? toStatus(row) : null;
}

/** All of the wallet's connector statuses (tokenless), for the UI. */
export async function listConnectors(walletAddress: string): Promise<ConnectorStatus[]> {
  const wallet = evmAddressSchema.parse(walletAddress);
  const rows = await prisma.evidenceConnector.findMany({
    where: { walletAddress: wallet },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toStatus);
}

/**
 * The decrypted OAuth token for the wallet's connection, or null if not connected.
 * SERVER-ONLY — the single place a stored token is turned back into plaintext, and
 * only to make the user's own read-only GitHub calls. Never returned over the wire.
 */
export async function getConnectorToken(
  walletAddress: string,
  provider: ConnectorProvider,
): Promise<string | null> {
  const wallet = evmAddressSchema.parse(walletAddress);
  const row = await prisma.evidenceConnector.findUnique({
    where: { walletAddress_provider: { walletAddress: wallet, provider } },
  });
  if (!row) return null;
  return decryptSecret(row.accessTokenEnc, deriveConnectorKey());
}

/** Disconnect: delete the wallet's connection for a provider. Returns rows removed
 *  (0 when there was nothing to disconnect). Wallet-scoped so it can only ever
 *  delete the caller's own connection. */
export async function deleteConnector(
  walletAddress: string,
  provider: ConnectorProvider,
): Promise<number> {
  const wallet = evmAddressSchema.parse(walletAddress);
  const { count } = await prisma.evidenceConnector.deleteMany({
    where: { walletAddress: wallet, provider },
  });
  return count;
}
