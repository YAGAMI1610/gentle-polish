import { geminiFromEnv } from "./gemini";
import { groqFromEnv } from "./groq";
import type { AIProvider } from "./provider";

/**
 * Which concrete `AIProvider` the app runs on, selected by config alone.
 *
 * Follows the `getEvidenceStorage()` precedent in `lib/storage/index.ts`: one env
 * var picks the implementation, and an unknown value THROWS rather than silently
 * falling back to something the operator did not ask for (CLAUDE.md rule 1).
 *
 * `AI_PROVIDER` defaults to `"gemini"` when unset, so every existing deployment
 * keeps its current behaviour with no configuration change.
 *
 * Deliberately NOT memoized, unlike the storage factory: `geminiFromEnv()` is not
 * either, providers are stateless and cheap to build, and skipping the singleton
 * avoids needing a `__resetForTests` seam just to change an env var in a test.
 */

export type AiProviderName = "gemini" | "groq";

/** The provider the environment selects. Throws on an unrecognised name. */
export function aiProviderName(): AiProviderName {
  const raw = process.env["AI_PROVIDER"]?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) return "gemini";
  if (raw === "gemini" || raw === "groq") return raw;
  throw new Error(
    `unknown AI_PROVIDER "${raw}" — supported: "gemini", "groq" (see apps/web/.env.example)`,
  );
}

/** The env var holding the API key for the selected provider — used to report
 * honestly which key is missing when the AI is not configured. */
export function aiApiKeyEnvVar(): string {
  return aiProviderName() === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY";
}

/**
 * Build the selected provider from the environment. Throws when its API key is
 * absent (each `*FromEnv` makes no network call without one) — callers gate on
 * `aiConfigured()` from `./probe` first.
 */
export function providerFromEnv(): AIProvider {
  const name = aiProviderName();
  switch (name) {
    case "groq":
      return groqFromEnv();
    case "gemini":
      return geminiFromEnv();
    default: {
      // Exhaustiveness: adding a name to AiProviderName stops this compiling.
      const unreachable: never = name;
      return unreachable;
    }
  }
}
