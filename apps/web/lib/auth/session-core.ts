/**
 * Pure session helpers (build step 9) — NO `next/headers` import, so they are
 * unit-testable in the node test env without a request scope. The request-bound
 * wrappers (getSession / requireWallet) live in ./session.ts.
 */
import type { SessionOptions } from "iron-session";
import { evmAddressSchema } from "@/lib/db/schemas";
import { UnauthorizedError } from "./errors";

/** What we persist in the encrypted iron-session cookie. */
export interface SessionData {
  /** The SIWE-verified wallet address (lowercased). Presence == authenticated. */
  address?: string;
  /** The one-time nonce issued for an in-progress sign-in (consumed on verify). */
  nonce?: string;
  /** The chain id the wallet signed in on. */
  chainId?: number;
  /** One-time CSRF state for an in-progress GitHub OAuth flow (LIMITATIONS item 8),
   *  minted by the connector `start` route and verified+cleared by `callback`. */
  githubOAuthState?: string;
}

export const SESSION_COOKIE_NAME = "commitai_session";
const MIN_PASSWORD_LENGTH = 32;

/**
 * Build iron-session options from env. Throws (loudly, no fake fallback) when
 * SESSION_PASSWORD is missing or too short — a weak/absent key would silently
 * undermine every session, so we refuse to run rather than degrade.
 */
export function getSessionOptions(): SessionOptions {
  const password = process.env["SESSION_PASSWORD"];
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SESSION_PASSWORD must be set to a random string of at least ${MIN_PASSWORD_LENGTH} characters. Generate one with \`openssl rand -base64 32\` and put it in apps/web/.env.`,
    );
  }
  return {
    cookieName: SESSION_COOKIE_NAME,
    password,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      path: "/",
    },
  };
}

/**
 * Resolve the authenticated wallet from session data, or throw 401. Pure — takes
 * the data, not the request — so the auth gate is testable in isolation.
 */
export function requireWalletFromSession(session: Pick<SessionData, "address">): string {
  if (!session.address) {
    throw new UnauthorizedError("connect your wallet to continue");
  }
  return evmAddressSchema.parse(session.address);
}
