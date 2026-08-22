import { NextResponse } from "next/server";
import { ServiceUnavailableError, toHttpError } from "@/lib/auth/errors";
import { getSession, requireWallet } from "@/lib/auth/session";
import { readGithubOAuthConfig, isGithubConnectorConfigured } from "@/lib/connectors/config";
import { buildAuthorizeUrl } from "@/lib/connectors/github";
import { generateOAuthState } from "@/lib/connectors/state";

/**
 * GET /api/connectors/github/start (LIMITATIONS item 8) — begin the real GitHub
 * OAuth authorization-code flow. Requires a signed-in wallet (the connection is
 * bound to it). Mints a one-time CSRF `state`, stores it in the encrypted session,
 * and 302-redirects to GitHub's authorize page. Returns 503 (honest "not
 * configured") when no OAuth app credentials are set — never a broken redirect.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Bind the eventual connection to the signed-in wallet.
    await requireWallet();

    const config = readGithubOAuthConfig();
    if (!config || !isGithubConnectorConfigured()) {
      throw new ServiceUnavailableError("github connector is not configured");
    }

    const state = generateOAuthState();
    const session = await getSession();
    session.githubOAuthState = state;
    await session.save();

    const authorizeUrl = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
      scope: config.scope,
    });
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    const { status, body } = toHttpError(err, "api/connectors/github/start");
    return NextResponse.json(body, { status });
  }
}
