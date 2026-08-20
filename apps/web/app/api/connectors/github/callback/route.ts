import { NextResponse } from "next/server";
import { BadRequestError, ForbiddenError, ServiceUnavailableError } from "@/lib/auth/errors";
import { getSession, requireWallet } from "@/lib/auth/session";
import {
  readAppOrigin,
  readGithubOAuthConfig,
  readGithubOAuthSecret,
} from "@/lib/connectors/config";
import { exchangeCodeForToken, fetchGithubLogin } from "@/lib/connectors/github";
import { verifyOAuthState } from "@/lib/connectors/state";
import { upsertConnector } from "@/lib/db";

/**
 * GET /api/connectors/github/callback (LIMITATIONS item 8) — the OAuth redirect
 * target. Verifies the one-time CSRF `state` against the session (constant-time,
 * fail-closed), exchanges the code for a token (real POST to GitHub), reads the
 * user's login, and persists the connection with the token ENCRYPTED at rest.
 *
 * This is a browser navigation, so every outcome ends in a redirect back to
 * /verify with a `status` flag (connected | denied | mismatch | error) — the user
 * always lands on a real page, and no internal error detail leaks into the URL.
 */
export const dynamic = "force-dynamic";

function base(req: Request): string {
  return readAppOrigin() ?? new URL(req.url).origin;
}

function backTo(req: Request, status: string): NextResponse {
  const url = new URL("/verify", base(req));
  url.searchParams.set("connect", "github");
  url.searchParams.set("status", status);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  try {
    const wallet = await requireWallet();
    const config = readGithubOAuthConfig();
    const secret = readGithubOAuthSecret();
    if (!config || !secret) {
      throw new ServiceUnavailableError("github connector is not configured");
    }

    const url = new URL(req.url);
    // The user declined consent on GitHub, or GitHub returned an error.
    if (url.searchParams.get("error")) {
      return backTo(req, "denied");
    }
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state") ?? undefined;
    if (!code) throw new BadRequestError("missing authorization code");

    // One-time CSRF state: verify against the session, then clear it regardless.
    const session = await getSession();
    const expected = session.githubOAuthState;
    delete session.githubOAuthState;
    await session.save();
    if (!verifyOAuthState(expected, returnedState)) {
      throw new ForbiddenError("oauth state mismatch");
    }

    const token = await exchangeCodeForToken({
      code,
      clientId: config.clientId,
      clientSecret: secret,
      redirectUri: config.redirectUri,
    });
    const login = await fetchGithubLogin(token.accessToken);
    await upsertConnector(wallet, {
      provider: "GITHUB",
      externalLogin: login,
      accessToken: token.accessToken,
      scope: token.scope.length > 0 ? token.scope : config.scope,
    });

    return backTo(req, "connected");
  } catch (err) {
    if (err instanceof ForbiddenError) return backTo(req, "mismatch");
    // Any other failure (bad code, GitHub error, not signed in, etc.) → honest
    // generic error flag; the user retries from a real page.
    return backTo(req, "error");
  }
}
