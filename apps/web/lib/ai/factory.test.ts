import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aiApiKeyEnvVar, aiProviderName, providerFromEnv } from "./factory";
import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { aiConfigured } from "./probe";

/**
 * Always-on: the `providerFromEnv()` selector honours `AI_PROVIDER`.
 *
 * Mirrors `lib/storage/index.test.ts` (the `EVIDENCE_STORAGE_DRIVER` suite): proves
 * both providers are wired and selectable by config alone, that the DEFAULT is
 * unchanged so existing deployments keep working, and that an unknown or
 * unconfigured selection fails loudly rather than falling back silently.
 *
 * No network: constructing either provider only stores a key and a model id.
 */

const KEYS = ["AI_PROVIDER", "GEMINI_API_KEY", "GROQ_API_KEY", "GROQ_MODEL"] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("aiProviderName", () => {
  it("defaults to gemini when AI_PROVIDER is unset — existing deployments are unaffected", () => {
    delete process.env["AI_PROVIDER"];
    expect(aiProviderName()).toBe("gemini");
  });

  it("treats an empty or whitespace-only value as unset", () => {
    process.env["AI_PROVIDER"] = "   ";
    expect(aiProviderName()).toBe("gemini");
  });

  it("selects groq, tolerating case and surrounding whitespace", () => {
    process.env["AI_PROVIDER"] = "  GROQ  ";
    expect(aiProviderName()).toBe("groq");
  });

  it("throws on an unknown provider name (no silent fallback)", () => {
    process.env["AI_PROVIDER"] = "anthropic";
    expect(() => aiProviderName()).toThrow(/unknown AI_PROVIDER/);
  });
});

describe("providerFromEnv", () => {
  it("returns the Gemini provider by default", () => {
    delete process.env["AI_PROVIDER"];
    process.env["GEMINI_API_KEY"] = "test-gemini-key";
    expect(providerFromEnv()).toBeInstanceOf(GeminiProvider);
  });

  it("returns the Groq provider by config alone", () => {
    process.env["AI_PROVIDER"] = "groq";
    process.env["GROQ_API_KEY"] = "gsk_test_key";
    const provider = providerFromEnv();
    expect(provider).toBeInstanceOf(GroqProvider);
    expect(provider.modelVersion).toBe("openai/gpt-oss-120b");
  });

  it("carries GROQ_MODEL into the provider's recorded modelVersion", () => {
    process.env["AI_PROVIDER"] = "groq";
    process.env["GROQ_API_KEY"] = "gsk_test_key";
    process.env["GROQ_MODEL"] = "openai/gpt-oss-20b";
    expect(providerFromEnv().modelVersion).toBe("openai/gpt-oss-20b");
  });

  it("throws naming GROQ_API_KEY when groq is selected but unconfigured", () => {
    process.env["AI_PROVIDER"] = "groq";
    delete process.env["GROQ_API_KEY"];
    expect(() => providerFromEnv()).toThrow(/GROQ_API_KEY/);
  });

  it("throws naming GEMINI_API_KEY when gemini is selected but unconfigured", () => {
    delete process.env["AI_PROVIDER"];
    delete process.env["GEMINI_API_KEY"];
    expect(() => providerFromEnv()).toThrow(/GEMINI_API_KEY/);
  });
});

describe("aiConfigured / aiApiKeyEnvVar — only the SELECTED provider's key counts", () => {
  it("reports not-configured when groq is selected but only a Gemini key exists", () => {
    process.env["AI_PROVIDER"] = "groq";
    process.env["GEMINI_API_KEY"] = "test-gemini-key";
    delete process.env["GROQ_API_KEY"];

    // The whole point: a Gemini key does not make a Groq deployment configured.
    expect(aiConfigured()).toBe(false);
    expect(aiApiKeyEnvVar()).toBe("GROQ_API_KEY");
  });

  it("reports configured once the selected provider's key is present", () => {
    process.env["AI_PROVIDER"] = "groq";
    process.env["GROQ_API_KEY"] = "gsk_test_key";
    expect(aiConfigured()).toBe(true);
  });

  it("reports not-configured when gemini is selected but only a Groq key exists", () => {
    delete process.env["AI_PROVIDER"];
    delete process.env["GEMINI_API_KEY"];
    process.env["GROQ_API_KEY"] = "gsk_test_key";

    expect(aiConfigured()).toBe(false);
    expect(aiApiKeyEnvVar()).toBe("GEMINI_API_KEY");
  });
});
