import type { Evidence } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ConnectorNotConnectedError, importGithubActivity, type GithubImportDeps } from "./import";

/** Always-on: the import orchestrator's control flow, exercised with in-test
 *  doubles for the token lookup, GitHub reads, and evidence writer. */

const PUSH_EVENT = {
  type: "PushEvent",
  created_at: "2026-08-19T10:00:00Z",
  repo: { name: "me/app" },
  payload: { size: 3, commits: [] },
};

function makeDeps(over: Partial<GithubImportDeps> = {}): GithubImportDeps {
  return {
    getToken: async () => "tok",
    fetchLogin: async () => "octocat",
    fetchEvents: async () => [PUSH_EVENT],
    store: async (_w, args) =>
      ({ id: "ev1", contentText: args.contentText }) as unknown as Evidence,
    ...over,
  };
}

describe("importGithubActivity", () => {
  it("throws ConnectorNotConnectedError when no token is stored (never fabricates)", async () => {
    await expect(
      importGithubActivity("0xabc", { goalId: "g1" }, makeDeps({ getToken: async () => null })),
    ).rejects.toBeInstanceOf(ConnectorNotConnectedError);
  });

  it("summarises real activity into a GITHUB evidence row with deterministic text", async () => {
    const store = vi.fn(
      async (_w: string, args: { goalId: string; type: "GITHUB"; contentText: string }) =>
        ({ id: "ev1", ...args }) as unknown as Evidence,
    );
    await importGithubActivity("0xabc", { goalId: "g1" }, makeDeps({ store }));

    expect(store).toHaveBeenCalledOnce();
    const [wallet, args] = store.mock.calls[0]!;
    expect(wallet).toBe("0xabc");
    expect(args.goalId).toBe("g1");
    expect(args.type).toBe("GITHUB");
    expect(args.contentText).toContain('"source": "github"');
    expect(args.contentText).toContain('"commits": 3');
    expect(args.contentText).toContain('"login": "octocat"');
  });

  it("threads goalId + checkInId + since through to the store and summary", async () => {
    const fetchEvents = vi.fn(async () => [
      PUSH_EVENT,
      {
        type: "PushEvent",
        created_at: "2020-01-01T00:00:00Z",
        repo: { name: "old/x" },
        payload: { size: 9 },
      },
    ]);
    const store = vi.fn(
      async (
        _w: string,
        args: { goalId: string; type: "GITHUB"; contentText: string; checkInId?: string },
      ) => ({ id: "ev1", ...args }) as unknown as Evidence,
    );
    await importGithubActivity(
      "0xabc",
      { goalId: "g1", checkInId: "c1", since: "2026-01-01T00:00:00Z" },
      makeDeps({ fetchEvents, store }),
    );
    const [, args] = store.mock.calls[0]!;
    expect(args.checkInId).toBe("c1");
    // The 2020 push is before `since` → excluded, so commits counts only the 2026 push.
    expect(args.contentText).toContain('"commits": 3');
  });
});
