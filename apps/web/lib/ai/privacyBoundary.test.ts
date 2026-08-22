import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDecisionInput } from "@/lib/db/schemas";
import { GroqProvider, type GroqFetch } from "./groq";
import { buildSystemInstruction } from "./promptGuards";
import type { AIProvider, GenerateRequest, GenerateResult } from "./provider";
import { runTurn } from "./runner";
import { toolSpecs } from "./tools/registry";

/**
 * Free-tier privacy boundary (LIMITATIONS.md §10, item 13). Always-on: no key, no
 * network, no database.
 *
 * CommitAI deliberately stays on a model vendor's **free** tier, where prompts and
 * responses may be used to improve that vendor's products. That is only acceptable
 * because raw evidence never leaves this process — and it holds for EVERY provider
 * (`gemini.ts`, `groq.ts`), because the guarantee is enforced here rather than by any
 * vendor's terms: the model is given goal/verification *metadata* and its own
 * summaries, never a user's uploaded bytes or `contentText`. That property is easy to
 * break by accident — one `evidence.contentText` spliced into a prompt would do it, and
 * nothing about it would fail at runtime — so these tests make it fail HERE.
 *
 * Three complementary layers, because no single one is sufficient:
 *   1. Reachability (source scan): nothing under `lib/ai/` even names a raw-evidence
 *      field, so no prompt can splice one in.
 *   2. Egress (source scan): each provider file is the ONLY place its vendor can be
 *      reached — `gemini.ts` alone imports the SDK, `groq.ts` alone names the Groq
 *      endpoint — so every way out for data is one of two audited files. Groq needs its
 *      own guard because it speaks plain HTTP: an SDK-import scan cannot see a `fetch`.
 *   3. Payload (behavioural): the only thing that crosses the `AIProvider` boundary is
 *      `{system, messages, tools}` built from the trust-boundary prompt, the user's own
 *      chat turns, and tool results — asserted against a recording provider.
 *
 * Plus the audit-log half: `createDecisionInput` bounds `evidenceRef` to an id/hash, and
 * the single call site in the repo passes an id.
 */

const aiDir = dirname(fileURLToPath(import.meta.url));
const webDir = join(aiDir, "..", "..");

/** Directories that are not this app's source and would make the scan crawl forever. */
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage", ".turbo", "generated"]);

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Every source file in the app, read ONCE at module scope. All three source guards below
 * are views over this one snapshot: scanning per-test instead would traverse the tree
 * three times and can blow vitest's 5s per-test budget on a loaded machine.
 */
const webSources = sourceFiles(webDir).map((f) => ({
  path: relative(webDir, f),
  text: readFileSync(f, "utf8"),
}));

const aiSources = webSources.filter((f) => f.path.startsWith(join("lib", "ai") + sep));

/**
 * The fields that hold — or resolve to — raw evidence. `contentText` is the untrusted
 * text a user submitted; `storageKey` points at the stored blob; `readEvidenceBlob`
 * returns its bytes. If any of these appears in the AI layer, raw evidence has become
 * reachable from a prompt.
 */
const RAW_EVIDENCE_ACCESSORS = [
  "contentText",
  "storageKey",
  "readEvidenceBlob",
  "evidenceBytes",
  "readBlob",
];

describe("no raw evidence is reachable from the AI layer (source guard)", () => {
  it("scans a real, non-empty set of AI source files (never passes vacuously)", () => {
    // If the layer is ever moved or renamed, this fails instead of silently
    // scanning nothing and reporting success.
    expect(aiSources.length).toBeGreaterThanOrEqual(20);
    expect(aiSources.map((f) => f.path)).toContain("lib/ai/gemini.ts");
    expect(aiSources.map((f) => f.path)).toContain("lib/ai/runner.ts");
    expect(aiSources.map((f) => f.path)).toContain("lib/ai/tools/analyzeEvidence.ts");
  });

  it("names no raw-evidence field anywhere under lib/ai/", () => {
    const hits: string[] = [];
    for (const file of aiSources) {
      for (const accessor of RAW_EVIDENCE_ACCESSORS) {
        if (file.text.includes(accessor)) hits.push(`${file.path} → ${accessor}`);
      }
    }
    // `analyzeEvidence` DOES read the Evidence row (for its type and hash) — that is
    // fine; what must never appear is the content itself. A hit here means someone
    // wired raw evidence into a code path that can reach a prompt.
    expect(hits).toEqual([]);
  });

  it("reads evidence only as type/id/hash where it reads it at all", () => {
    const analyze = aiSources.find((f) => f.path === "lib/ai/tools/analyzeEvidence.ts");
    expect(analyze).toBeDefined();
    const text = analyze?.text ?? "";
    // It genuinely does fetch the row…
    expect(text).toContain("getEvidence(ctx.walletAddress, args.evidenceId)");
    // …and the only fields it takes off it are the objective ones.
    for (const field of [
      "evidence.type",
      "evidence.contentHash",
      "evidence.id",
      "evidence.goalId",
    ]) {
      expect(text, field).toContain(field);
    }
  });
});

describe("the egress points to the model are exactly the provider files (source guard)", () => {
  it("only lib/ai/gemini.ts imports the vendor SDK", () => {
    // Scans the WHOLE app, not just `lib/ai/` — the point is that no route, component or
    // job can talk to Google directly, bypassing the boundary asserted below.
    expect(webSources.length).toBeGreaterThanOrEqual(150);
    // A real `from "@google/genai"` specifier, not a prose mention of the package —
    // `provider.ts`'s doc comment names it precisely to say it does NOT import it.
    const importsSdk = /from\s*["']@google\/genai["']/;
    const importers = webSources.filter((f) => importsSdk.test(f.text)).map((f) => f.path);
    expect(importers).toEqual(["lib/ai/gemini.ts"]);
  });

  it("only lib/ai/groq.ts names the Groq API host", () => {
    // The SDK scan above CANNOT police Groq: it speaks an OpenAI-compatible HTTP API
    // with no SDK, so a bare `fetch("https://api.groq.com/...")` in any route, job or
    // component would be a second egress point that no import regex would ever see.
    // Pinning the host to the provider file closes that hole.
    expect(webSources.length).toBeGreaterThanOrEqual(150);
    const namesGroqHost = /api\.groq\.com/;
    const namers = webSources.filter((f) => namesGroqHost.test(f.text)).map((f) => f.path);
    expect(namers).toEqual(["lib/ai/groq.ts"]);
  });
});

/** Records every request that crosses the `AIProvider` boundary. */
class RecordingProvider implements AIProvider {
  readonly modelVersion = "recording-model-v0";
  readonly requests: GenerateRequest[] = [];
  constructor(private readonly replies: GenerateResult[]) {}
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    // Deep-copy at capture time: the runner appends the model's reply to the SAME
    // `messages` array it sent, so holding the reference would show us the transcript
    // as it looked afterwards rather than what was actually transmitted.
    this.requests.push({
      ...request,
      messages: structuredClone(request.messages),
    });
    return this.replies[this.requests.length - 1] ?? { text: "done", toolCalls: [] };
  }
}

describe("what crosses the AIProvider boundary carries no evidence payload", () => {
  it("sends only {system, messages, tools} — there is no field an upload could ride in", async () => {
    const provider = new RecordingProvider([{ text: "noted", toolCalls: [] }]);
    await runTurn({
      provider,
      walletAddress: "0x1111111111111111111111111111111111111111",
      userMessage: "I ran 5km this morning.",
    });

    expect(provider.requests).toHaveLength(1);
    const sent = provider.requests[0];
    expect(sent).toBeDefined();
    // `signal` is only present when the caller passes one; it carries no data.
    expect(Object.keys(sent ?? {}).sort()).toEqual(["messages", "system", "tools"]);
    // The transcript is exactly the user's own chat turn — nothing was loaded into it.
    expect(sent?.messages).toEqual([{ kind: "user_text", text: "I ran 5km this morning." }]);
  });

  it("builds the system instruction from author-controlled text only", () => {
    const system = buildSystemInstruction();
    expect(system).toContain("TRUST BOUNDARY");
    // The prompt describes the evidence fence; it never contains evidence.
    expect(system).not.toContain("contentText");
    expect(system).not.toContain("storageKey");
    // A toolPolicy is app-authored routing context and is appended AFTER the
    // immutable preamble — it is the only caller-supplied part of the system text.
    const withPolicy = buildSystemInstruction("Focus on goal g_1.");
    expect(withPolicy.indexOf("TRUST BOUNDARY")).toBeLessThan(
      withPolicy.indexOf("Focus on goal g_1."),
    );
  });

  it("advertises no tool parameter that accepts evidence content", () => {
    const specs = toolSpecs();
    expect(specs.length).toBeGreaterThanOrEqual(15);
    const offenders: string[] = [];
    for (const spec of specs) {
      const props = (spec.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      for (const name of Object.keys(props)) {
        if (RAW_EVIDENCE_ACCESSORS.some((a) => name.toLowerCase().includes(a.toLowerCase()))) {
          offenders.push(`${spec.name}.${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("takes evidence into a tool by id, and any summary is the MODEL's own words", () => {
    const analyze = toolSpecs().find((s) => s.name === "analyzeEvidence");
    expect(analyze).toBeDefined();
    const params = analyze?.parameters as {
      required: string[];
      properties: Record<string, { description?: string; maxLength?: number }>;
    };
    // The evidence is addressed by id; the content is never a parameter.
    expect(params.required).toEqual(["evidenceId"]);
    expect(Object.keys(params.properties).sort()).toEqual([
      "checkInId",
      "consistency",
      "evidenceId",
      "evidenceSummary",
      "milestoneId",
      "plausibility",
    ]);
    // `evidenceSummary` flows model → app (it is stored for display), NOT app → model,
    // and the schema tells the model in so many words not to paste content into it.
    expect(params.properties["evidenceSummary"]?.description).toMatch(/not a paste/i);
  });

  it("carries no evidence payload ON THE WIRE when Groq is the provider talking", async () => {
    // The test above inspects the `AIProvider` *request object*. That cannot catch a
    // provider which adds something on its way out, so this one asserts against the
    // real serialised HTTP body: the actual bytes that would leave the process. Only
    // the network hop is doubled — the mapping and body assembly are the real code.
    const transmitted: string[] = [];
    const fetchFn: GroqFetch = async (_url, init) => {
      transmitted.push(init.body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "noted" } }] }),
      };
    };

    await runTurn({
      provider: new GroqProvider("test-key-never-real", "openai/gpt-oss-120b", fetchFn),
      walletAddress: "0x1111111111111111111111111111111111111111",
      userMessage: "I ran 5km this morning.",
    });

    expect(transmitted).toHaveLength(1);
    const body = JSON.parse(transmitted[0] ?? "{}") as Record<string, unknown>;
    // The model id, the transcript, and the tool schemas. There is no other field —
    // so there is nothing an upload could ride in, exactly as for the Gemini path.
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "tools"]);

    // The transcript is the author-controlled system prompt plus the user's own turn.
    const messages = body["messages"] as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[0]?.content).toContain("TRUST BOUNDARY");
    expect(messages[1]?.content).toBe("I ran 5km this morning.");

    // And nothing anywhere in the payload — prompt, tool schemas, or transcript —
    // names a raw-evidence field.
    for (const accessor of RAW_EVIDENCE_ACCESSORS) {
      expect(transmitted[0], accessor).not.toContain(accessor);
    }
  });
});

describe("the decision log records an evidence id/hash, never raw evidence", () => {
  const base = { toolName: "analyzeEvidence", action: "evidence.analyze", decision: "ok" };

  it("accepts an id and a sha256 hash", () => {
    expect(createDecisionInput.parse({ ...base, evidenceRef: "ckq1abcd0000xyz" }).evidenceRef).toBe(
      "ckq1abcd0000xyz",
    );
    const sha = "a".repeat(64);
    expect(createDecisionInput.parse({ ...base, evidenceRef: sha }).evidenceRef).toBe(sha);
  });

  it("rejects a pasted evidence blob — the field is far too small to hold one", () => {
    // An evidence `contentText` may be up to 20,000 chars; `evidenceRef` caps at 256,
    // so a paste cannot fit even if a future call site tried.
    expect(() => createDecisionInput.parse({ ...base, evidenceRef: "x".repeat(257) })).toThrow();
    expect(() =>
      createDecisionInput.parse({ ...base, evidenceRef: "my run screenshot ".repeat(200) }),
    ).toThrow();
    expect(() => createDecisionInput.parse({ ...base, evidenceRef: "" })).toThrow();
  });

  it("has exactly one writer in the repo, and it passes an id (source guard)", () => {
    const writers: string[] = [];
    for (const file of webSources) {
      for (const line of file.text.split("\n")) {
        // Skip the schema/repository declarations and prose — only assignments count.
        if (!/^\s*evidenceRef:\s*\S/.test(line)) continue;
        if (file.path === join("lib", "db", "repositories", "decisionLog.ts")) continue;
        if (file.path === join("lib", "db", "schemas.ts")) continue;
        writers.push(`${file.path} → ${line.trim()}`);
      }
    }
    expect(writers).toEqual([
      "lib/ai/tools/analyzeEvidence.ts → evidenceRef: evidence.id, // id only — never raw evidence (§10)",
    ]);
  });
});
