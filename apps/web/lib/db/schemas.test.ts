import { describe, expect, it } from "vitest";
import { CheckInFrequency, EvidenceType, GoalCategory, GoalMode, GoalStatus } from "@prisma/client";
import {
  createCheckInInput,
  createEvidenceInput,
  createGoalInput,
  evmAddressSchema,
  progressSchema,
  sha256HexSchema,
} from "./schemas";

/**
 * Boundary-schema unit tests. These need no database and always run — they
 * exercise the shape validation that every write passes through before it
 * reaches Prisma.
 */

describe("evmAddressSchema", () => {
  it("accepts a 0x-prefixed 40-hex address and lowercases it", () => {
    const mixed = "0xAbC0000000000000000000000000000000000001";
    expect(evmAddressSchema.parse(mixed)).toBe(mixed.toLowerCase());
  });

  it("trims surrounding whitespace before validating", () => {
    const addr = "0x0000000000000000000000000000000000000abc";
    expect(evmAddressSchema.parse(`  ${addr}  `)).toBe(addr);
  });

  it("rejects wrong length, missing prefix, and non-hex chars", () => {
    expect(() => evmAddressSchema.parse("0x123")).toThrow();
    expect(() => evmAddressSchema.parse("abc0000000000000000000000000000000000001")).toThrow();
    expect(() => evmAddressSchema.parse("0xZZ00000000000000000000000000000000000001")).toThrow();
  });
});

describe("progressSchema", () => {
  it("accepts integers in 0..100", () => {
    expect(progressSchema.parse(0)).toBe(0);
    expect(progressSchema.parse(37)).toBe(37);
    expect(progressSchema.parse(100)).toBe(100);
  });

  it("rejects out-of-range values and non-integers", () => {
    expect(() => progressSchema.parse(-1)).toThrow();
    expect(() => progressSchema.parse(101)).toThrow();
    expect(() => progressSchema.parse(3.5)).toThrow();
  });
});

describe("sha256HexSchema", () => {
  it("accepts 64 hex chars and normalizes to lowercase", () => {
    expect(sha256HexSchema.parse("A".repeat(64))).toBe("a".repeat(64));
  });

  it("rejects wrong length or non-hex input", () => {
    expect(() => sha256HexSchema.parse("a".repeat(63))).toThrow();
    expect(() => sha256HexSchema.parse("a".repeat(65))).toThrow();
    expect(() => sha256HexSchema.parse("g".repeat(64))).toThrow();
  });
});

describe("createGoalInput", () => {
  const base = {
    title: "Run a 5k",
    summary: "Train and complete a 5k run",
    mode: GoalMode.SELF_COMMITMENT,
    checkInFrequency: "Every week",
  };

  it("applies the documented defaults for omitted fields", () => {
    const parsed = createGoalInput.parse(base);
    expect(parsed.category).toBe(GoalCategory.GENERIC);
    expect(parsed.status).toBe(GoalStatus.ACTIVE);
    expect(parsed.progress).toBe(0);
    expect(parsed.checkInCadence).toBe(CheckInFrequency.WEEKLY);
  });

  it("coerces an ISO date string to a Date", () => {
    const parsed = createGoalInput.parse({ ...base, deadline: "2026-12-31T00:00:00.000Z" });
    expect(parsed.deadline).toBeInstanceOf(Date);
  });

  it("requires title, summary, mode and checkInFrequency", () => {
    expect(() => createGoalInput.parse({ ...base, title: "" })).toThrow();
    expect(() => createGoalInput.parse({ ...base, checkInFrequency: "" })).toThrow();
    expect(() =>
      createGoalInput.parse({ title: "t", summary: "s", checkInFrequency: "Every week" }),
    ).toThrow();
  });

  it("rejects an invalid enum value", () => {
    expect(() => createGoalInput.parse({ ...base, mode: "NOT_A_MODE" })).toThrow();
  });
});

describe("createCheckInInput", () => {
  it("requires goalId and a bounded, non-empty message", () => {
    expect(createCheckInInput.parse({ goalId: "g1", message: "did the run" })).toMatchObject({
      goalId: "g1",
      message: "did the run",
    });
    expect(() => createCheckInInput.parse({ goalId: "g1", message: "" })).toThrow();
    expect(() => createCheckInInput.parse({ goalId: "g1", message: "x".repeat(5001) })).toThrow();
  });
});

describe("createEvidenceInput", () => {
  const contentHash = "b".repeat(64);

  it("requires goalId, type and a valid contentHash", () => {
    const parsed = createEvidenceInput.parse({
      goalId: "g1",
      type: EvidenceType.TEXT,
      contentText: "here is my proof",
      contentHash,
    });
    expect(parsed.contentHash).toBe(contentHash);
    expect(parsed.type).toBe(EvidenceType.TEXT);
  });

  it("rejects a malformed contentHash", () => {
    expect(() =>
      createEvidenceInput.parse({ goalId: "g1", type: EvidenceType.TEXT, contentHash: "nope" }),
    ).toThrow();
  });
});
