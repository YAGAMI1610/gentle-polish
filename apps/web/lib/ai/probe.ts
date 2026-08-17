/**
 * Test/runtime gate for the live model.
 *
 * Mirrors `lib/db/probe.ts`: live-model tests call `geminiConfigured()` and skip
 * cleanly when no key is present, exactly as the DB integration tests skip when
 * Postgres is unreachable. Kept out of the public barrel (`index.ts`) — it is an
 * environment check, not part of the AI surface.
 */
export function geminiConfigured(): boolean {
  const key = process.env["GEMINI_API_KEY"];
  return typeof key === "string" && key.trim().length > 0;
}
