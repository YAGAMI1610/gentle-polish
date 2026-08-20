import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGithubEvents,
  fetchGithubLogin,
  GITHUB_TOKEN_URL,
  parseTokenResponse,
  summarizeGithubEvents,
  summaryToEvidenceText,
  type FetchLike,
} from "./github";

/** Minimal in-test transport: a real function shaped like the injected `fetch`,
 *  returning a structural HttpResponse. The GitHub protocol is really exercised;
 *  only the network hop is doubled (the onchainBackfill DI idiom). */
function resp(
  body: unknown,
  init?: { ok?: boolean; status?: number },
): {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
} {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("buildAuthorizeUrl", () => {
  it("includes client id, encoded redirect, scope, state, and allow_signup=false", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://app.example/api/connectors/github/callback",
        state: "st4te",
        scope: "read:user",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/api/connectors/github/callback",
    );
    expect(url.searchParams.get("scope")).toBe("read:user");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("allow_signup")).toBe("false");
  });
});

describe("parseTokenResponse", () => {
  it("extracts the access token, scope, and type", () => {
    const t = parseTokenResponse({
      access_token: "gho_x",
      scope: "read:user",
      token_type: "bearer",
    });
    expect(t).toEqual({ accessToken: "gho_x", scope: "read:user", tokenType: "bearer" });
  });

  it("throws on GitHub's 200-with-error shape", () => {
    expect(() =>
      parseTokenResponse({ error: "bad_verification_code", error_description: "expired" }),
    ).toThrow(/expired/);
  });

  it("throws when access_token is missing or the body is not an object", () => {
    expect(() => parseTokenResponse({ scope: "read:user" })).toThrow(/access_token/);
    expect(() => parseTokenResponse(null)).toThrow(/JSON object/);
  });
});

describe("summarizeGithubEvents", () => {
  const events = [
    {
      type: "PushEvent",
      created_at: "2026-08-18T10:00:00Z",
      repo: { name: "me/shipit" },
      payload: { size: 2, commits: [{ message: "a" }, { message: "b" }] },
    },
    {
      type: "PullRequestEvent",
      created_at: "2026-08-19T12:00:00Z",
      repo: { name: "me/shipit" },
      payload: { action: "opened", pull_request: { title: "Add feature", merged: false } },
    },
    {
      type: "PullRequestEvent",
      created_at: "2026-08-17T09:00:00Z",
      repo: { name: "org/lib" },
      payload: { action: "closed", pull_request: { title: "Fix bug", merged: true } },
    },
    {
      type: "WatchEvent",
      created_at: "2026-08-19T13:00:00Z",
      repo: { name: "org/lib" },
      payload: {},
    },
  ];

  it("counts real commits, PRs opened/merged, distinct sorted repos, and the window", () => {
    const s = summarizeGithubEvents(events, { login: "me" });
    expect(s.login).toBe("me");
    expect(s.totalEvents).toBe(4);
    expect(s.commits).toBe(2);
    expect(s.pullRequestsOpened).toBe(1);
    expect(s.pullRequestsMerged).toBe(1);
    expect(s.repos).toEqual(["me/shipit", "org/lib"]);
    expect(s.windowStart).toBe("2026-08-17T09:00:00.000Z");
    expect(s.windowEnd).toBe("2026-08-19T13:00:00.000Z");
  });

  it("drops events older than `since`", () => {
    const s = summarizeGithubEvents(events, { login: "me", since: "2026-08-18T00:00:00Z" });
    // The 08-17 merged PR is excluded.
    expect(s.pullRequestsMerged).toBe(0);
    expect(s.totalEvents).toBe(3);
  });

  it("ignores malformed entries without throwing", () => {
    const s = summarizeGithubEvents([null, 42, "x", {}], { login: "me" });
    expect(s.totalEvents).toBe(1); // only the {} record counts as an event
    expect(s.commits).toBe(0);
  });

  it("summaryToEvidenceText is deterministic for the same input", () => {
    const a = summaryToEvidenceText(summarizeGithubEvents(events, { login: "me" }));
    const b = summaryToEvidenceText(summarizeGithubEvents(events, { login: "me" }));
    expect(a).toBe(b);
    expect(a).toContain('"source": "github"');
    expect(a).toContain('"commits": 2');
  });
});

describe("IO with injected transport", () => {
  it("exchangeCodeForToken posts to the token URL and returns the parsed token", async () => {
    const fetchFn = vi.fn<FetchLike>(async (url) => {
      expect(url).toBe(GITHUB_TOKEN_URL);
      return resp({ access_token: "gho_ok", scope: "read:user", token_type: "bearer" });
    });
    const token = await exchangeCodeForToken(
      { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://a/cb" },
      fetchFn,
    );
    expect(token.accessToken).toBe("gho_ok");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("exchangeCodeForToken throws on GitHub's error body", async () => {
    const fetchFn: FetchLike = async () => resp({ error: "bad_verification_code" });
    await expect(
      exchangeCodeForToken(
        { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://a/cb" },
        fetchFn,
      ),
    ).rejects.toThrow(/bad_verification_code/);
  });

  it("fetchGithubLogin returns the login and throws on non-2xx", async () => {
    const ok: FetchLike = async () => resp({ login: "octocat" });
    expect(await fetchGithubLogin("tok", ok)).toBe("octocat");

    const bad: FetchLike = async () => resp({}, { ok: false, status: 401 });
    await expect(fetchGithubLogin("tok", bad)).rejects.toThrow(/401/);
  });

  it("fetchGithubEvents returns an array, tolerates a non-array body, and throws on non-2xx", async () => {
    const arr: FetchLike = async () => resp([{ type: "PushEvent" }]);
    expect(await fetchGithubEvents("tok", "octocat", arr)).toHaveLength(1);

    const notArr: FetchLike = async () => resp({ message: "nope" });
    expect(await fetchGithubEvents("tok", "octocat", notArr)).toEqual([]);

    const bad: FetchLike = async () => resp({}, { ok: false, status: 404 });
    await expect(fetchGithubEvents("tok", "octocat", bad)).rejects.toThrow(/404/);
  });
});
