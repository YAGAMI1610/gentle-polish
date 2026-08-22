import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GROQ_MODEL,
  GROQ_CHAT_COMPLETIONS_URL,
  GroqProvider,
  groqFromEnv,
  type GroqFetch,
  type GroqHttpResponse,
} from "./groq";
import type { AIMessage } from "./provider";

/**
 * Groq provider — always-on tests: no key, no network, no DB.
 *
 * Only the network hop is doubled (the `s3Storage.test.ts` / connectors DI idiom):
 * the request shaping, the `AIMessage` → OpenAI-message mapping, the
 * `tool_call_id` correlation, and the response parsing are all the real code. The
 * live end-to-end test against the real API is `groq.integration.test.ts`, gated
 * on `GROQ_API_KEY`.
 */

const KEY = "gsk_test_key_never_real";
const MODEL = "openai/gpt-oss-120b";

/** A canned HTTP response for the injected transport. */
function res(init: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  raw?: string;
}): GroqHttpResponse {
  const text = init.raw ?? JSON.stringify(init.body ?? {});
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => text,
  };
}

/** A 200 completion carrying just assistant text. */
function textReply(content: string | null): GroqHttpResponse {
  return res({ body: { choices: [{ message: { role: "assistant", content } }] } });
}

/** A 200 completion carrying tool calls. */
function toolReply(calls: { id?: string; name: string; args: string }[]): GroqHttpResponse {
  return res({
    body: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: calls.map((c, i) => ({
              id: c.id ?? `call_${i}`,
              type: "function",
              function: { name: c.name, arguments: c.args },
            })),
          },
        },
      ],
    },
  });
}

/** Read back the JSON body the provider actually transmitted. */
function sentBody(fetchFn: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchFn.mock.calls[0]?.[1] as { body: string } | undefined;
  expect(init, "expected a request to have been sent").toBeDefined();
  return JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
}

describe("GroqProvider.generate — request shaping", () => {
  it("POSTs to the Groq chat-completions endpoint with a bearer key and the model", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("hi"));
    const provider = new GroqProvider(KEY, MODEL, fetchFn);

    await provider.generate({ system: "SYS", messages: [{ kind: "user_text", text: "hello" }] });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(GROQ_CHAT_COMPLETIONS_URL);
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(init?.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(init?.headers["content-type"]).toBe("application/json");
    expect(sentBody(fetchFn)["model"]).toBe(MODEL);
  });

  it("sends the system instruction as a leading system message", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "TRUST BOUNDARY: rules here",
      messages: [{ kind: "user_text", text: "hello" }],
    });

    expect(sentBody(fetchFn)["messages"]).toEqual([
      { role: "system", content: "TRUST BOUNDARY: rules here" },
      { role: "user", content: "hello" },
    ]);
  });

  it("advertises tools in OpenAI function shape, passing the JSON Schema through", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    const parameters = {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    };

    await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "SYS",
      messages: [{ kind: "user_text", text: "make a goal" }],
      tools: [{ name: "createGoal", description: "Create a goal", parameters }],
    });

    expect(sentBody(fetchFn)["tools"]).toEqual([
      {
        type: "function",
        function: { name: "createGoal", description: "Create a goal", parameters },
      },
    ]);
  });

  it("omits `tools` entirely when none are advertised", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "SYS",
      messages: [{ kind: "user_text", text: "hi" }],
    });

    const body = sentBody(fetchFn);
    expect("tools" in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(["messages", "model"]);
  });

  it("forwards an abort signal to the transport", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    const controller = new AbortController();

    await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "SYS",
      messages: [{ kind: "user_text", text: "hi" }],
      signal: controller.signal,
    });

    expect(fetchFn.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

describe("GroqProvider.generate — transcript mapping", () => {
  it("maps all four AIMessage kinds onto their OpenAI equivalents", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    const messages: AIMessage[] = [
      { kind: "user_text", text: "I ran 5km" },
      { kind: "model_text", text: "Nice work" },
      {
        kind: "model_tool_calls",
        toolCalls: [{ name: "updateProgress", args: { goalId: "g_1" } }],
      },
      { kind: "tool_result", name: "updateProgress", response: { ok: true } },
    ];

    await new GroqProvider(KEY, MODEL, fetchFn).generate({ system: "SYS", messages });

    expect(sentBody(fetchFn)["messages"]).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "I ran 5km" },
      { role: "assistant", content: "Nice work" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_2_0",
            type: "function",
            function: { name: "updateProgress", arguments: '{"goalId":"g_1"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_2_0", content: '{"ok":true}' },
    ]);
  });

  it("correlates each tool result to its own call when one turn has several", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    const messages: AIMessage[] = [
      { kind: "user_text", text: "do both" },
      {
        kind: "model_tool_calls",
        toolCalls: [
          { name: "createGoal", args: { title: "A" } },
          { name: "scheduleCheckIn", args: { cadence: "weekly" } },
        ],
      },
      { kind: "tool_result", name: "scheduleCheckIn", response: { ok: true, data: "second" } },
      { kind: "tool_result", name: "createGoal", response: { ok: true, data: "first" } },
    ];

    await new GroqProvider(KEY, MODEL, fetchFn).generate({ system: "SYS", messages });

    // sent = [system, user, assistant(tool_calls), tool, tool]
    const sent = sentBody(fetchFn)["messages"] as Record<string, unknown>[];
    // Results arrive out of order; each must still carry the id of ITS OWN call.
    // Ids index the REQUEST transcript, where the tool-calls message is at 1.
    expect(sent[3]).toMatchObject({ role: "tool", tool_call_id: "call_1_1" });
    expect(sent[4]).toMatchObject({ role: "tool", tool_call_id: "call_1_0" });
  });

  it("gives two calls of the SAME tool distinct ids, matched first-in-first-out", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    const messages: AIMessage[] = [
      { kind: "user_text", text: "two goals" },
      {
        kind: "model_tool_calls",
        toolCalls: [
          { name: "createGoal", args: { title: "first" } },
          { name: "createGoal", args: { title: "second" } },
        ],
      },
      { kind: "tool_result", name: "createGoal", response: { ok: true, data: 1 } },
      { kind: "tool_result", name: "createGoal", response: { ok: true, data: 2 } },
    ];

    await new GroqProvider(KEY, MODEL, fetchFn).generate({ system: "SYS", messages });

    // sent = [system, user, assistant(tool_calls), tool, tool]
    const sent = sentBody(fetchFn)["messages"] as Record<string, unknown>[];
    const calls = (sent[2]?.["tool_calls"] ?? []) as { id: string }[];
    expect(calls.map((c) => c.id)).toEqual(["call_1_0", "call_1_1"]);
    // Distinct ids, consumed in order — never the same id twice.
    expect(sent[3]?.["tool_call_id"]).toBe("call_1_0");
    expect(sent[4]?.["tool_call_id"]).toBe("call_1_1");
  });

  it("refuses to fabricate an id for an orphan tool_result", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("ok"));
    const provider = new GroqProvider(KEY, MODEL, fetchFn);

    await expect(
      provider.generate({
        system: "SYS",
        // A hand-crafted history could contain a result with no preceding call.
        messages: [{ kind: "tool_result", name: "claimReward", response: { ok: true } }],
      }),
    ).rejects.toThrow(/no preceding tool_call/);

    // Nothing was transmitted — it failed before reaching the network.
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("GroqProvider.generate — response parsing", () => {
  it("returns assistant text with no tool calls", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply("Logged your run."));
    const out = await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "SYS",
      messages: [{ kind: "user_text", text: "hi" }],
    });

    expect(out).toEqual({ text: "Logged your run.", toolCalls: [] });
  });

  it("returns null text and the parsed tool calls when the model only calls tools", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () =>
      toolReply([{ name: "createGoal", args: '{"title":"Run a 10k","cadence":"weekly"}' }]),
    );

    const out = await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "SYS",
      messages: [{ kind: "user_text", text: "commit me" }],
    });

    expect(out.text).toBeNull();
    expect(out.toolCalls).toEqual([
      { name: "createGoal", args: { title: "Run a 10k", cadence: "weekly" } },
    ]);
  });

  it("treats empty-string content as null (the interface's 'no text' contract)", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => textReply(""));
    const out = await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "SYS",
      messages: [{ kind: "user_text", text: "hi" }],
    });

    expect(out.text).toBeNull();
  });

  it("tolerates a response with no choices rather than crashing on an index", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () => res({ body: { choices: [] } }));
    const out = await new GroqProvider(KEY, MODEL, fetchFn).generate({
      system: "SYS",
      messages: [{ kind: "user_text", text: "hi" }],
    });

    expect(out).toEqual({ text: null, toolCalls: [] });
  });

  it("throws (never a silent empty args object) on malformed tool arguments", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () =>
      toolReply([{ name: "claimReward", args: "{not json" }]),
    );
    const provider = new GroqProvider(KEY, MODEL, fetchFn);

    await expect(
      provider.generate({ system: "SYS", messages: [{ kind: "user_text", text: "hi" }] }),
    ).rejects.toThrow(/malformed arguments for tool "claimReward"/);
  });

  it("throws when tool arguments parse to a non-object", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () =>
      toolReply([{ name: "createGoal", args: "[1,2]" }]),
    );
    const provider = new GroqProvider(KEY, MODEL, fetchFn);

    await expect(
      provider.generate({ system: "SYS", messages: [{ kind: "user_text", text: "hi" }] }),
    ).rejects.toThrow(/non-object arguments for tool "createGoal"/);
  });
});

describe("GroqProvider.generate — API errors", () => {
  it("throws with the status and provider message, and never leaks the API key", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () =>
      res({ ok: false, status: 401, raw: '{"error":{"message":"Invalid API Key"}}' }),
    );
    const provider = new GroqProvider(KEY, MODEL, fetchFn);

    const err = await provider
      .generate({ system: "SYS", messages: [{ kind: "user_text", text: "hi" }] })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );

    expect(err, "expected generate() to reject on a non-2xx").not.toBeNull();
    expect(err?.message).toContain("Groq API error 401");
    expect(err?.message).toContain("Invalid API Key");
    // MONEY/SECRET safety: the key is a header, never part of an error string.
    expect(err?.message).not.toContain(KEY);
  });

  it("truncates a very large error body instead of echoing all of it", async () => {
    const fetchFn = vi.fn<GroqFetch>(async () =>
      res({ ok: false, status: 500, raw: "x".repeat(5000) }),
    );
    const provider = new GroqProvider(KEY, MODEL, fetchFn);

    const err = await provider
      .generate({ system: "SYS", messages: [{ kind: "user_text", text: "hi" }] })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );

    expect(err, "expected generate() to reject on a 500").not.toBeNull();
    expect(err?.message).toContain("truncated");
    expect(err?.message.length ?? 0).toBeLessThan(700);
  });
});

describe("groqFromEnv", () => {
  const saved = { key: process.env["GROQ_API_KEY"], model: process.env["GROQ_MODEL"] };

  const restore = () => {
    if (saved.key === undefined) delete process.env["GROQ_API_KEY"];
    else process.env["GROQ_API_KEY"] = saved.key;
    if (saved.model === undefined) delete process.env["GROQ_MODEL"];
    else process.env["GROQ_MODEL"] = saved.model;
  };

  it("throws a pointed error when GROQ_API_KEY is absent", () => {
    delete process.env["GROQ_API_KEY"];
    try {
      expect(() => groqFromEnv()).toThrow(/GROQ_API_KEY is not set/);
    } finally {
      restore();
    }
  });

  it("defaults the model and honours a GROQ_MODEL override", () => {
    process.env["GROQ_API_KEY"] = KEY;
    try {
      delete process.env["GROQ_MODEL"];
      expect(groqFromEnv().modelVersion).toBe(DEFAULT_GROQ_MODEL);
      expect(DEFAULT_GROQ_MODEL).toBe("openai/gpt-oss-120b");

      process.env["GROQ_MODEL"] = "  openai/gpt-oss-20b  ";
      expect(groqFromEnv().modelVersion).toBe("openai/gpt-oss-20b");
    } finally {
      restore();
    }
  });
});
