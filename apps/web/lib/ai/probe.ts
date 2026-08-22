import { aiApiKeyEnvVar, aiProviderName } from "./factory";

/**
 * Test/runtime gate for the live model.
 *
 * Mirrors `lib/db/probe.ts`: live-model tests call `geminiConfigured()` /
 * `groqConfigured()` and skip cleanly when no key is present, exactly as the DB
 * integration tests skip when Postgres is unreachable. Kept out of the public
 * barrel (`index.ts`) — it is an environment check, not part of the AI surface.
 */
export function geminiConfigured(): boolean {
  const key = process.env["GEMINI_API_KEY"];
  return typeof key === "string" && key.trim().length > 0;
}

export function groqConfigured(): boolean {
  const key = process.env["GROQ_API_KEY"];
  return typeof key === "string" && key.trim().length > 0;
}

/**
 * Whether the provider `AI_PROVIDER` selects actually has its key — the check a
 * route should make before building a provider. Only the SELECTED provider's key
 * matters: a Gemini key does not make a Groq deployment configured.
 */
export function aiConfigured(): boolean {
  return aiProviderName() === "groq" ? groqConfigured() : geminiConfigured();
}

/** Name of the env var that is missing when `aiConfigured()` is false, so callers
 * can say which key to set instead of guessing at Gemini's. */
export function missingAiApiKeyEnvVar(): string {
  return aiApiKeyEnvVar();
}
