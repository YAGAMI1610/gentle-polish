import { describe, expect, it } from "vitest";
import { groupByKey, indexByKey } from "./grouping";

/**
 * Always-on unit tests for the batch-loader grouping helpers (build-prompt §16 /
 * item 6). No database: these prove the pure in-memory split that lets a single
 * grouped query stand in for a per-goal query. The property that matters is ORDER
 * PRESERVATION — the batch repositories sort in SQL (milestones by orderIndex,
 * verification records newest-first) and rely on these to keep that order within
 * each group, so the list view is byte-for-byte what the per-goal reads produced.
 */

interface Row {
  goalId: string;
  n: number;
}
const row = (goalId: string, n: number): Row => ({ goalId, n });

describe("groupByKey", () => {
  it("returns an empty map for no rows", () => {
    expect(groupByKey([], (r: Row) => r.goalId).size).toBe(0);
  });

  it("groups rows by key and preserves input order WITHIN each group", () => {
    // Interleaved just like a single `ORDER BY` result over multiple goals would be.
    const rows = [row("a", 1), row("b", 1), row("a", 2), row("a", 3), row("b", 2)];
    const grouped = groupByKey(rows, (r) => r.goalId);
    expect(grouped.get("a")?.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(grouped.get("b")?.map((r) => r.n)).toEqual([1, 2]);
  });

  it("omits keys with no rows (caller defaults to an empty list)", () => {
    const grouped = groupByKey([row("a", 1)], (r) => r.goalId);
    expect(grouped.has("b")).toBe(false);
    expect(grouped.get("b") ?? []).toEqual([]);
  });
});

describe("indexByKey", () => {
  it("returns an empty map for no rows", () => {
    expect(indexByKey([], (r: Row) => r.goalId).size).toBe(0);
  });

  it("indexes one row per key (unique relation — a goal has at most one)", () => {
    const grouped = indexByKey([row("a", 1), row("b", 2)], (r) => r.goalId);
    expect(grouped.get("a")?.n).toBe(1);
    expect(grouped.get("b")?.n).toBe(2);
  });

  it("keeps the FIRST row seen for a key and ignores later duplicates", () => {
    // Defensive: a well-formed unique relation never duplicates, but if it did the
    // first (e.g. the newest, given a sorted query) must win, not the last.
    const grouped = indexByKey([row("a", 1), row("a", 99)], (r) => r.goalId);
    expect(grouped.get("a")?.n).toBe(1);
    expect(grouped.size).toBe(1);
  });
});
