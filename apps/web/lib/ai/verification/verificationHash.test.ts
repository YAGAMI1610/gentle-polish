import { describe, expect, it } from "vitest";

import { computeVerificationHash } from "./verificationHash";

describe("computeVerificationHash", () => {
  const base = {
    goalId: "goal_1",
    milestoneId: "ms_1",
    result: { status: "VERIFIED", confidence: 82 },
    timestamp: "2026-01-02T03:04:05.000Z",
    evidenceHash: "a".repeat(64),
    modelVersion: "gemini-3.7-flash",
  };

  it("produces a 64-char sha256 hex string", () => {
    const hash = computeVerificationHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", () => {
    expect(computeVerificationHash(base)).toBe(computeVerificationHash(base));
  });

  it("does not depend on the property order of the input object", () => {
    const reordered = {
      modelVersion: base.modelVersion,
      evidenceHash: base.evidenceHash,
      timestamp: base.timestamp,
      result: base.result,
      milestoneId: base.milestoneId,
      goalId: base.goalId,
    };
    expect(computeVerificationHash(reordered)).toBe(computeVerificationHash(base));
  });

  it("changes when any anchored field changes", () => {
    const ref = computeVerificationHash(base);
    expect(computeVerificationHash({ ...base, goalId: "goal_2" })).not.toBe(ref);
    expect(computeVerificationHash({ ...base, timestamp: "2026-01-02T03:04:06.000Z" })).not.toBe(
      ref,
    );
    expect(
      computeVerificationHash({ ...base, result: { status: "UNVERIFIED", confidence: 10 } }),
    ).not.toBe(ref);
    expect(computeVerificationHash({ ...base, evidenceHash: "b".repeat(64) })).not.toBe(ref);
  });

  it("treats absent optional fields as null (stable across undefined vs omitted)", () => {
    const omitted = { goalId: "g", result: { ok: true }, timestamp: "t" };
    const explicitNull = {
      goalId: "g",
      milestoneId: null,
      result: { ok: true },
      timestamp: "t",
      evidenceHash: null,
      modelVersion: null,
    };
    expect(computeVerificationHash(omitted)).toBe(computeVerificationHash(explicitNull));
  });
});
