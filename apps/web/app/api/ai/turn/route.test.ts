import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealData } from "iron-session";

/**
 * POST /api/ai/turn — the provider CONFIGURATION boundary (LIMITATIONS.md §26.6).
 *
 * Drives the REAL route handler. The only seam is `next/headers` `cookies()`, so the
 * test can present a genuinely iron-session-sealed cookie — the same seam, and the
 * same password, as `app/api/security.test.ts`. Always-on: no database and no
 * network, because every case here fails at provider resolution, before `runTurn`.
 *
 * What these prove is deployment honesty (CLAUDE.md rule 1). An operator whose only
 * remaining step is "paste the API key" has to be told WHICH key — and a typo in
 * `AI_PROVIDER` must not arrive as a detail-free 500, which is exactly what
 * `toHttpError`'s fallback does to the plain `Error` the factory throws.
 */

const TEST_PASSWORD = "commitai_test_session_password_0123456789"; // >= 32 chars
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookie !== undefined ? { name, value: state.cookie } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

process.env["SESSION_PASSWORD"] = TEST_PASSWORD;

// Imported after the mock is registered (vitest hoists `vi.mock`).
import { POST as postAiTurn } from "./route";

const BASE = "http://localhost:3000";
const ADDR = "0x1111111111111111111111111111111111111111";

const ENV_KEYS = ["AI_PROVIDER", "GEMINI_API_KEY", "GROQ_API_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env["SESSION_PASSWORD"] = TEST_PASSWORD;
  // Signed in — so these tests exercise the config gate, not the auth gate.
  state.cookie = await sealData({ address: ADDR }, { password: TEST_PASSWORD });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** A well-formed, same-origin, authenticated turn request. */
function turnReq(): Request {
  const headers = new Headers({ origin: BASE, "content-type": "application/json" });
  return new Request(`${BASE}/api/ai/turn`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userMessage: "I ran 5km this morning." }),
  });
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: unknown };
  return typeof body.error === "string" ? body.error : "";
}

describe("POST /api/ai/turn reports a misconfigured provider honestly (always-on)", () => {
  it("503s naming GROQ_API_KEY when groq is selected without its key", async () => {
    process.env["AI_PROVIDER"] = "groq";
    delete process.env["GROQ_API_KEY"];
    // The other provider's key is present and must NOT count as configured.
    process.env["GEMINI_API_KEY"] = "a-gemini-key-that-must-not-count";

    const res = await postAiTurn(turnReq());
    expect(res.status).toBe(503);
    const error = await errorOf(res);
    expect(error).toContain("GROQ_API_KEY");
    expect(error).not.toContain("GEMINI_API_KEY");
  });

  it("503s naming GEMINI_API_KEY on a default deployment (AI_PROVIDER unset)", async () => {
    delete process.env["AI_PROVIDER"];
    delete process.env["GEMINI_API_KEY"];
    process.env["GROQ_API_KEY"] = "gsk_a_groq_key_that_must_not_count";

    const res = await postAiTurn(turnReq());
    expect(res.status).toBe(503);
    const error = await errorOf(res);
    expect(error).toContain("GEMINI_API_KEY");
    expect(error).not.toContain("GROQ_API_KEY");
  });

  it("503s quoting a typo'd AI_PROVIDER rather than a detail-free 500", async () => {
    process.env["AI_PROVIDER"] = "grok"; // the near-universal typo for "groq"
    process.env["GROQ_API_KEY"] = "gsk_test_key";

    const res = await postAiTurn(turnReq());
    // Without `resolveProvider()` this is a 500 whose body is "internal error".
    expect(res.status).toBe(503);
    const error = await errorOf(res);
    expect(error).toContain("grok");
    expect(error).toContain("supported");
    expect(error).not.toBe("internal error");
  });

  it("never echoes an API key value in the failure body", async () => {
    const SECRET = "gsk_super_secret_key_value_0123456789";
    process.env["AI_PROVIDER"] = "not-a-provider";
    process.env["GROQ_API_KEY"] = SECRET;
    process.env["GEMINI_API_KEY"] = SECRET;

    const res = await postAiTurn(turnReq());
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(SECRET);
  });
});
