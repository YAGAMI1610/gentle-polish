/**
 * GitHub OAuth connector configuration, resolved from the environment
 * (LIMITATIONS.md item 8 — the real evidence connector for the /verify
 * "Connect data" tab).
 *
 * Same two honesty rules as `lib/chain/config.ts` (CLAUDE.md rule 1):
 *  - When the OAuth app credentials are UNSET, the configured-predicate returns
 *    false and callers report an honest "not configured" — the /verify Connect
 *    button stays disabled with a truthful note, never a fake success or a dead
 *    button pretending to work.
 *  - A value that is SET but malformed throws loudly here (a typo in the client
 *    id or redirect URI is a misconfiguration that must fail, not silently
 *    degrade to "not configured").
 *
 * The client SECRET is read by a separate function (`readGithubOAuthSecret`),
 * mirroring `readAttestorKey`, so a logged/serialized config object can never
 * carry it. The secret is only ever used server-side in the token exchange.
 */

type Env = Record<string, string | undefined>;

/** Default OAuth scope: read the user's profile + public activity. No repo-write,
 *  no private-repo access — the connector only ever READS activity for evidence. */
export const DEFAULT_GITHUB_SCOPE = "read:user";

/** Path the GitHub OAuth callback returns to (mounted by the callback route). */
export const GITHUB_CALLBACK_PATH = "/api/connectors/github/callback";

export interface GithubOAuthConfig {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
}

/** The app's public origin (scheme + host), used to build the OAuth redirect URI.
 *  Returns null when neither APP_ORIGIN nor NEXT_PUBLIC_APP_URL is a valid URL. */
export function readAppOrigin(env: Env = process.env): string | null {
  const raw = env["APP_ORIGIN"] ?? env["NEXT_PUBLIC_APP_URL"];
  if (!raw || raw.trim() === "") return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    throw new Error(`APP_ORIGIN / NEXT_PUBLIC_APP_URL is set but not a valid URL: "${raw}"`);
  }
}

/**
 * Resolve the (non-secret) GitHub OAuth config, or null when the connector is not
 * configured (no client id). Throws when SET but unusable — e.g. a client id is
 * present but no redirect URI can be resolved (neither GITHUB_OAUTH_REDIRECT_URI
 * nor an app origin), which would otherwise produce a broken authorize URL.
 */
export function readGithubOAuthConfig(env: Env = process.env): GithubOAuthConfig | null {
  const clientId = env["GITHUB_OAUTH_CLIENT_ID"]?.trim();
  if (!clientId) return null;

  const explicitRedirect = env["GITHUB_OAUTH_REDIRECT_URI"]?.trim();
  let redirectUri: string;
  if (explicitRedirect) {
    try {
      redirectUri = new URL(explicitRedirect).toString();
    } catch {
      throw new Error(
        `GITHUB_OAUTH_REDIRECT_URI is set but not a valid URL: "${explicitRedirect}"`,
      );
    }
  } else {
    const origin = readAppOrigin(env);
    if (!origin) {
      throw new Error(
        "GITHUB_OAUTH_CLIENT_ID is set but no redirect URI can be resolved. Set GITHUB_OAUTH_REDIRECT_URI, or APP_ORIGIN / NEXT_PUBLIC_APP_URL.",
      );
    }
    redirectUri = new URL(GITHUB_CALLBACK_PATH, origin).toString();
  }

  const scope = env["GITHUB_OAUTH_SCOPE"]?.trim() || DEFAULT_GITHUB_SCOPE;
  return { clientId, redirectUri, scope };
}

/**
 * The GitHub OAuth client secret, or null if unset. Server-only, read separately
 * from `GithubOAuthConfig` so it never rides along in a logged config object.
 */
export function readGithubOAuthSecret(env: Env = process.env): string | null {
  const v = env["GITHUB_OAUTH_CLIENT_SECRET"]?.trim();
  return v && v.length > 0 ? v : null;
}

/**
 * True when the connector is fully configured for a live OAuth flow: a client id
 * (→ resolvable config) AND a client secret. When false, callers report "not
 * configured" and the UI keeps the Connect button disabled with an honest note.
 */
export function isGithubConnectorConfigured(env: Env = process.env): boolean {
  return readGithubOAuthConfig(env) !== null && readGithubOAuthSecret(env) !== null;
}
