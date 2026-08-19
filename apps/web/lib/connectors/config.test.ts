import { describe, expect, it } from "vitest";
import {
  DEFAULT_GITHUB_SCOPE,
  GITHUB_CALLBACK_PATH,
  isGithubConnectorConfigured,
  readAppOrigin,
  readGithubOAuthConfig,
  readGithubOAuthSecret,
} from "./config";

/**
 * Always-on: the connector's config resolution follows the same honesty contract
 * as chain/config — unset → "not configured" (null/false), SET-but-malformed →
 * throw. No DB or network needed.
 */
describe("readGithubOAuthConfig", () => {
  it("returns null when no client id is set (honest 'not configured')", () => {
    expect(readGithubOAuthConfig({})).toBeNull();
    expect(readGithubOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: "   " })).toBeNull();
  });

  it("derives the redirect URI from the app origin + callback path", () => {
    const cfg = readGithubOAuthConfig({
      GITHUB_OAUTH_CLIENT_ID: "cid",
      APP_ORIGIN: "https://commitai.example",
    });
    expect(cfg).not.toBeNull();
    expect(cfg?.clientId).toBe("cid");
    expect(cfg?.redirectUri).toBe(`https://commitai.example${GITHUB_CALLBACK_PATH}`);
    expect(cfg?.scope).toBe(DEFAULT_GITHUB_SCOPE);
  });

  it("prefers an explicit redirect URI and custom scope", () => {
    const cfg = readGithubOAuthConfig({
      GITHUB_OAUTH_CLIENT_ID: "cid",
      GITHUB_OAUTH_REDIRECT_URI: "https://alt.example/cb",
      GITHUB_OAUTH_SCOPE: "read:user repo",
    });
    expect(cfg?.redirectUri).toBe("https://alt.example/cb");
    expect(cfg?.scope).toBe("read:user repo");
  });

  it("throws when a client id is set but no redirect URI can be resolved", () => {
    expect(() => readGithubOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: "cid" })).toThrow(/redirect URI/);
  });

  it("throws when the explicit redirect URI is malformed", () => {
    expect(() =>
      readGithubOAuthConfig({
        GITHUB_OAUTH_CLIENT_ID: "cid",
        GITHUB_OAUTH_REDIRECT_URI: "not a url",
      }),
    ).toThrow(/GITHUB_OAUTH_REDIRECT_URI/);
  });
});

describe("readAppOrigin", () => {
  it("returns null when unset and the origin (not full URL) when set", () => {
    expect(readAppOrigin({})).toBeNull();
    expect(readAppOrigin({ APP_ORIGIN: "https://a.example/some/path" })).toBe("https://a.example");
    expect(readAppOrigin({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
  });

  it("throws when set but not a valid URL", () => {
    expect(() => readAppOrigin({ APP_ORIGIN: "://bad" })).toThrow();
  });
});

describe("readGithubOAuthSecret + isGithubConnectorConfigured", () => {
  it("reads the secret separately and never from the config object", () => {
    expect(readGithubOAuthSecret({})).toBeNull();
    expect(readGithubOAuthSecret({ GITHUB_OAUTH_CLIENT_SECRET: "s3cr3t" })).toBe("s3cr3t");
  });

  it("is configured only when BOTH a resolvable config and a secret exist", () => {
    expect(isGithubConnectorConfigured({})).toBe(false);
    // client id but no secret → not configured
    expect(
      isGithubConnectorConfigured({
        GITHUB_OAUTH_CLIENT_ID: "cid",
        APP_ORIGIN: "https://x.example",
      }),
    ).toBe(false);
    // both present → configured
    expect(
      isGithubConnectorConfigured({
        GITHUB_OAUTH_CLIENT_ID: "cid",
        GITHUB_OAUTH_CLIENT_SECRET: "sec",
        APP_ORIGIN: "https://x.example",
      }),
    ).toBe(true);
  });
});
