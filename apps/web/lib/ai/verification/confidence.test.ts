import { SignalLevel, VerificationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { calculateVerificationConfidence, levelScore } from "./confidence";

const { LOW, MEDIUM, HIGH } = SignalLevel;

describe("levelScore", () => {
  it("is monotonic in the signal level", () => {
    expect(levelScore(LOW)).toBeLessThan(levelScore(MEDIUM));
    expect(levelScore(MEDIUM)).toBeLessThan(levelScore(HIGH));
  });
});

describe("calculateVerificationConfidence", () => {
  it("returns a 0-100 confidence", () => {
    const { confidence } = calculateVerificationConfidence({
      plausibility: MEDIUM,
      evidenceQuality: MEDIUM,
      consistency: MEDIUM,
    });
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(100);
  });

  it("verifies only when confident AND evidence is non-LOW", () => {
    const strong = calculateVerificationConfidence({
      plausibility: HIGH,
      evidenceQuality: HIGH,
      consistency: HIGH,
    });
    expect(strong.status).toBe(VerificationStatus.VERIFIED);
  });

  it("never verifies on LOW evidence quality, even with high plausibility/consistency", () => {
    const { status } = calculateVerificationConfidence({
      plausibility: HIGH,
      evidenceQuality: LOW,
      consistency: HIGH,
    });
    expect(status).not.toBe(VerificationStatus.VERIFIED);
  });

  it("returns UNVERIFIED when every signal is LOW", () => {
    const { status } = calculateVerificationConfidence({
      plausibility: LOW,
      evidenceQuality: LOW,
      consistency: LOW,
    });
    expect(status).toBe(VerificationStatus.UNVERIFIED);
  });

  it("respects a stricter threshold", () => {
    const signals = { plausibility: MEDIUM, evidenceQuality: MEDIUM, consistency: MEDIUM };
    const lenient = calculateVerificationConfidence(signals, 40);
    const strict = calculateVerificationConfidence(signals, 100);
    expect(lenient.status).toBe(VerificationStatus.VERIFIED);
    expect(strict.status).not.toBe(VerificationStatus.VERIFIED);
  });

  it("clamps out-of-range thresholds instead of misbehaving", () => {
    const signals = { plausibility: HIGH, evidenceQuality: HIGH, consistency: HIGH };
    expect(calculateVerificationConfidence(signals, -50).status).toBe(VerificationStatus.VERIFIED);
    expect(calculateVerificationConfidence(signals, 999).confidence).toBeLessThanOrEqual(100);
  });
});
