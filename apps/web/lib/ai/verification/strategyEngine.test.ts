import { CheckInFrequency, GoalCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { buildStrategy, listCategories, registerCategory } from "./strategyEngine";

describe("strategyEngine registry", () => {
  it("registers a built-in for every GoalCategory", () => {
    const registered = new Set(listCategories());
    for (const category of Object.values(GoalCategory)) {
      expect(registered.has(category)).toBe(true);
    }
  });

  it("every built-in strategy combines at least two independent signals", () => {
    for (const category of Object.values(GoalCategory)) {
      const s = buildStrategy("goal_x", category, "some goal text");
      expect(s.methods.length).toBeGreaterThanOrEqual(2);
      expect(s.requiredEvidence.length).toBeGreaterThanOrEqual(1);
      expect(s.verificationQuestions.length).toBeGreaterThanOrEqual(2);
      expect(s.confidenceThreshold).toBeGreaterThan(0);
      expect(s.confidenceThreshold).toBeLessThanOrEqual(100);
      expect(s.fallback.length).toBeGreaterThan(0);
      expect(s.goalId).toBe("goal_x");
    }
  });

  it("falls back to GENERIC for an unregistered category without throwing", () => {
    // Cast an unknown value through to exercise the fallback branch.
    const s = buildStrategy("goal_y", "NOT_A_REAL_CATEGORY" as GoalCategory, "text");
    expect(s.goalId).toBe("goal_y");
    expect(s.methods.length).toBeGreaterThanOrEqual(2);
  });

  it("allows overriding a category builder", () => {
    const original = buildStrategy("g", GoalCategory.GENERIC, "t");
    try {
      registerCategory(GoalCategory.GENERIC, (goalId) => ({
        goalId,
        measurement: "overridden",
        methods: ["a", "b"],
        requiredEvidence: original.requiredEvidence,
        verificationQuestions: ["q1", "q2"],
        frequency: CheckInFrequency.DAILY,
        confidenceThreshold: 99,
        fallback: "overridden fallback",
      }));
      expect(buildStrategy("g", GoalCategory.GENERIC, "t").measurement).toBe("overridden");
    } finally {
      // Restore so test order can't leak into other suites.
      registerCategory(GoalCategory.GENERIC, () => original);
    }
  });
});
