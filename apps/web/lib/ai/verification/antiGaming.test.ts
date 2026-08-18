import { describe, expect, it } from "vitest";

import {
  detectGenericAnswer,
  detectImpossibleDelta,
  detectRepeatedEvidence,
  detectTimestampAnomaly,
} from "./antiGaming";

describe("detectRepeatedEvidence", () => {
  it("flags an exact hash re-submission", () => {
    expect(detectRepeatedEvidence("h1", ["h0", "h1"])).toBe(true);
  });
  it("passes genuinely new evidence", () => {
    expect(detectRepeatedEvidence("h2", ["h0", "h1"])).toBe(false);
    expect(detectRepeatedEvidence("h0", [])).toBe(false);
  });
});

describe("detectImpossibleDelta", () => {
  it("flags progress claimed with no time elapsed", () => {
    expect(detectImpossibleDelta({ previousProgress: 10, nextProgress: 40, elapsedDays: 0 })).toBe(
      true,
    );
  });
  it("does not flag non-increasing progress", () => {
    expect(detectImpossibleDelta({ previousProgress: 40, nextProgress: 40, elapsedDays: 0 })).toBe(
      false,
    );
    expect(detectImpossibleDelta({ previousProgress: 40, nextProgress: 20, elapsedDays: 0 })).toBe(
      false,
    );
  });
  it("flags a per-day rate beyond the goal's ceiling", () => {
    expect(
      detectImpossibleDelta({
        previousProgress: 0,
        nextProgress: 90,
        elapsedDays: 1,
        maxPointsPerDay: 20,
      }),
    ).toBe(true);
  });
  it("allows a plausible rate under the ceiling", () => {
    expect(
      detectImpossibleDelta({
        previousProgress: 0,
        nextProgress: 15,
        elapsedDays: 1,
        maxPointsPerDay: 20,
      }),
    ).toBe(false);
  });
  it("is unbounded by default when no ceiling is given", () => {
    expect(detectImpossibleDelta({ previousProgress: 0, nextProgress: 100, elapsedDays: 1 })).toBe(
      false,
    );
  });
});

describe("detectGenericAnswer", () => {
  it("flags empty and near-empty answers", () => {
    expect(detectGenericAnswer("")).toBe(true);
    expect(detectGenericAnswer("   ")).toBe(true);
    expect(detectGenericAnswer("ok")).toBe(true);
  });
  it("flags stock phrases regardless of trailing punctuation", () => {
    expect(detectGenericAnswer("done")).toBe(true);
    expect(detectGenericAnswer("I did it.")).toBe(true);
    expect(detectGenericAnswer("Yes!")).toBe(true);
  });
  it("passes a specific, substantive answer", () => {
    expect(
      detectGenericAnswer(
        "I finished chapter 4 on retry storms and how exponential backoff helps.",
      ),
    ).toBe(false);
  });
});

describe("detectTimestampAnomaly", () => {
  const submittedAt = new Date("2026-02-01T00:00:00.000Z");
  it("returns false when no claimed time is given", () => {
    expect(detectTimestampAnomaly({ submittedAt })).toBe(false);
    expect(detectTimestampAnomaly({ submittedAt, claimedAt: null })).toBe(false);
  });
  it("flags activity claimed in the future", () => {
    expect(
      detectTimestampAnomaly({ submittedAt, claimedAt: new Date("2026-02-02T00:00:00.000Z") }),
    ).toBe(true);
  });
  it("passes activity claimed at or before submission", () => {
    expect(
      detectTimestampAnomaly({ submittedAt, claimedAt: new Date("2026-01-31T00:00:00.000Z") }),
    ).toBe(false);
  });
});
