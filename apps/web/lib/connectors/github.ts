/**
 * GitHub OAuth + activity connector (LIMITATIONS.md item 8).
 *
 * This is a REAL OAuth authorization-code integration against github.com — not a
 * mock (CLAUDE.md rule 1). It is split into:
 *
 *   - PURE functions (URL building, token-response parsing, activity → evidence
 *     summarisation) that are unit-tested always-on with no network; and
 *   - IO functions (`exchangeCodeForToken`, `fetchGithubLogin`, `fetchGithubEvents`)
 *     that take an injected `fetch`, so their request/response handling is tested
 *     with an in-test transport (the same dependency-injection seam as
 *     `onchainBackfill`). A live end-to-end exchange additionally needs a real
 *     configured OAuth app + user consent, which is gated on config.
 *
 * Fetched GitHub activity is UNTRUSTED external content (CLAUDE.md rule 5): it is
 * parsed defensively, summarised into a structured record, and stored as an
 * off-chain `Evidence` row of type GITHUB (sha256-hashed like any other text
 * evidence). It is never interpreted as instructions and never anchored on-chain
 * except as its hash.
 */

export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API_URL = "https://api.github.com";

/** Bound the number of activity lines folded into one evidence snapshot, so the
 *  canonical text stays well under the 20k-char evidence cap regardless of how
 *  much history GitHub returns. */
const MAX_ITEMS = 25;
const MAX_TITLE_LEN = 200;

// ---------------------------------------------------------------------------
// Pure: authorize URL
// ---------------------------------------------------------------------------

export interface AuthorizeUrlParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope: string;
}

/** Build the GitHub authorize URL the user is redirected to. `allow_signup=false`
 *  keeps the flow to existing accounts; `state` is the CSRF token (see state.ts). */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Pure: token-response parsing
// ---------------------------------------------------------------------------

export interface GithubToken {
  readonly accessToken: string;
  readonly scope: string;
  readonly tokenType: string;
}

/**
 * Parse GitHub's token endpoint JSON. GitHub returns HTTP 200 even for failures,
 * carrying `{error, error_description}` instead of `{access_token}` — so we detect
 * the error shape explicitly and throw, rather than trusting the status code.
 */
export function parseTokenResponse(body: unknown): GithubToken {
  if (typeof body !== "object" || body === null) {
    throw new Error("github token response was not a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (typeof b["error"] === "string") {
    const desc = typeof b["error_description"] === "string" ? b["error_description"] : b["error"];
    throw new Error(`github token exchange failed: ${desc}`);
  }
  const accessToken = b["access_token"];
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("github token response missing access_token");
  }
  const scope = typeof b["scope"] === "string" ? b["scope"] : "";
  const tokenType = typeof b["token_type"] === "string" ? b["token_type"] : "bearer";
  return { accessToken, scope, tokenType };
}

// ---------------------------------------------------------------------------
// Pure: activity → evidence summary
// ---------------------------------------------------------------------------

export interface GithubActivitySummary {
  readonly login: string;
  readonly totalEvents: number;
  readonly commits: number;
  readonly pullRequestsOpened: number;
  readonly pullRequestsMerged: number;
  readonly repos: readonly string[];
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly items: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function truncate(s: string): string {
  return s.length > MAX_TITLE_LEN ? `${s.slice(0, MAX_TITLE_LEN)}…` : s;
}

/**
 * Fold a GitHub events array (from `/users/{login}/events`) into a structured,
 * deterministic summary. Counts real commits (PushEvent) and pull requests
 * (PullRequestEvent opened/merged), the distinct repos touched, and the observed
 * time window. Optional `since` (ISO) drops events older than that instant. Purely
 * derived from the input — no value is invented (rule 1).
 */
export function summarizeGithubEvents(
  events: readonly unknown[],
  opts: { login: string; since?: string },
): GithubActivitySummary {
  const sinceMs = opts.since ? Date.parse(opts.since) : Number.NaN;
  const hasSince = !Number.isNaN(sinceMs);

  let commits = 0;
  let pullRequestsOpened = 0;
  let pullRequestsMerged = 0;
  let totalEvents = 0;
  const repos = new Set<string>();
  const times: number[] = [];
  const items: string[] = [];

  for (const raw of events) {
    const ev = asRecord(raw);
    if (!ev) continue;
    const createdAt = typeof ev["created_at"] === "string" ? ev["created_at"] : null;
    if (hasSince && createdAt) {
      const t = Date.parse(createdAt);
      if (!Number.isNaN(t) && t < sinceMs) continue;
    }
    const type = typeof ev["type"] === "string" ? ev["type"] : "";
    const repo = asRecord(ev["repo"]);
    const repoName = repo && typeof repo["name"] === "string" ? repo["name"] : "";
    const payload = asRecord(ev["payload"]) ?? {};

    totalEvents += 1;
    if (repoName) repos.add(repoName);
    if (createdAt) {
      const t = Date.parse(createdAt);
      if (!Number.isNaN(t)) times.push(t);
    }

    if (type === "PushEvent") {
      const commitList = Array.isArray(payload["commits"]) ? (payload["commits"] as unknown[]) : [];
      const size = typeof payload["size"] === "number" ? payload["size"] : commitList.length;
      commits += size;
      if (items.length < MAX_ITEMS) {
        items.push(truncate(`push: ${size} commit(s) to ${repoName || "a repository"}`));
      }
    } else if (type === "PullRequestEvent") {
      const action = typeof payload["action"] === "string" ? payload["action"] : "";
      const pr = asRecord(payload["pull_request"]);
      const title = pr && typeof pr["title"] === "string" ? pr["title"] : "";
      const merged = pr ? pr["merged"] === true : false;
      if (action === "opened") pullRequestsOpened += 1;
      if (action === "closed" && merged) pullRequestsMerged += 1;
      if (items.length < MAX_ITEMS) {
        const verb = action === "closed" && merged ? "merged PR" : `${action || "updated"} PR`;
        items.push(truncate(`${verb} in ${repoName || "a repository"}: ${title}`.trim()));
      }
    }
  }

  times.sort((a, b) => a - b);
  const first = times[0];
  const last = times[times.length - 1];
  return {
    login: opts.login,
    totalEvents,
    commits,
    pullRequestsOpened,
    pullRequestsMerged,
    repos: [...repos].sort(),
    windowStart: first !== undefined ? new Date(first).toISOString() : null,
    windowEnd: last !== undefined ? new Date(last).toISOString() : null,
    items,
  };
}

/**
 * Canonical evidence text for a summary: a stable, pretty-printed JSON document
 * (fixed key order) so the same activity always hashes to the same digest. This
 * string is what `storeEvidence` sha256-hashes and stores off-chain.
 */
export function summaryToEvidenceText(summary: GithubActivitySummary): string {
  const canonical = {
    source: "github",
    login: summary.login,
    totalEvents: summary.totalEvents,
    commits: summary.commits,
    pullRequestsOpened: summary.pullRequestsOpened,
    pullRequestsMerged: summary.pullRequestsMerged,
    repos: summary.repos,
    windowStart: summary.windowStart,
    windowEnd: summary.windowEnd,
    items: summary.items,
  };
  return JSON.stringify(canonical, null, 2);
}

// ---------------------------------------------------------------------------
// IO: injectable fetch (real github.com protocol; transport is injected)
// ---------------------------------------------------------------------------

interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<HttpResponse>;

const defaultFetch = fetch as unknown as FetchLike;

function apiHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "CommitAI-evidence-connector",
  };
}

export interface ExchangeArgs {
  readonly code: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/** Exchange an authorization code for an access token (real POST to GitHub). */
export async function exchangeCodeForToken(
  args: ExchangeArgs,
  fetchFn: FetchLike = defaultFetch,
): Promise<GithubToken> {
  const res = await fetchFn(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });
  const body = await res.json().catch(() => null);
  // GitHub returns 200 even on error, carrying {error,...} — parseTokenResponse
  // throws on that shape, so a non-2xx here is an additional guard, not the only one.
  if (!res.ok && (body === null || typeof body !== "object")) {
    throw new Error(`github token exchange HTTP ${res.status}`);
  }
  return parseTokenResponse(body);
}

/** Fetch the authenticated user's login (identity for the stored connection). */
export async function fetchGithubLogin(
  accessToken: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<string> {
  const res = await fetchFn(`${GITHUB_API_URL}/user`, { headers: apiHeaders(accessToken) });
  if (!res.ok) throw new Error(`github /user failed: HTTP ${res.status}`);
  const body = await res.json();
  const login = asRecord(body)?.["login"];
  if (typeof login !== "string" || login.length === 0) {
    throw new Error("github /user response missing login");
  }
  return login;
}

/** Fetch the user's recent public events (commits/PRs) for evidence synthesis. */
export async function fetchGithubEvents(
  accessToken: string,
  login: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<unknown[]> {
  const res = await fetchFn(
    `${GITHUB_API_URL}/users/${encodeURIComponent(login)}/events?per_page=100`,
    { headers: apiHeaders(accessToken) },
  );
  if (!res.ok) throw new Error(`github events failed: HTTP ${res.status}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}
