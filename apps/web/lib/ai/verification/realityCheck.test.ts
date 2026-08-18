import { SignalLevel, VerificationStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { runRealityCheck } from "./realityCheck";

const { LOW, MEDIUM, HIGH } = SignalLevel;

// Vocabulary the reasoning must never use: the check reports what cannot be
// confirmed, it does not accuse the person (§6.3).
const ACCUSATORY =
  /\b(lie|lied|lying|liar|fake|faking|faked|fraud|fraudulent|cheat|cheated|cheating|dishonest|deceit|deceptive|deceive|fabricat\w*|scam|liar)\b/i;

describe("runRealityCheck — outcomes", () => {
  it("verifies when independent signals are strong and agree", () => {
    const r = runRealityCheck({ plausibility: HIGH, evidenceQuality: HIGH, consistency: HIGH });
    expect(r.status).toBe(VerificationStatus.VERIFIED);
    expect(r.confidence).toBeGreaterThanOrEqual(70);
  });

  it("defaults missing signals to LOW and stays unverified", () => {
    const r = runRealityCheck({});
    expect(r.status).toBe(VerificationStatus.UNVERIFIED);
  });

  it("asks for more when the start is reasonable but thin", () => {
    const r = runRealityCheck({ plausibility: MEDIUM, evidenceQuality: MEDIUM, consistency: LOW });
    expect([VerificationStatus.NEEDS_MORE_EVIDENCE, VerificationStatus.UNVERIFIED]).toContain(
      r.status,
    );
  });
});

describe("runRealityCheck — hard gates cannot be overridden by optimistic signals", () => {
  it("rejects a direct contradiction even when all signals are HIGH", () => {
    const r = runRealityCheck({
      plausibility: HIGH,
      evidenceQuality: HIGH,
      consistency: HIGH,
      contradiction: true,
    });
    expect(r.status).toBe(VerificationStatus.REJECTED_AS_INCONSISTENT);
    expect(r.confidence).toBeLessThanOrEqual(25);
  });

  it("rejects a physically impossible progress jump regardless of signals", () => {
    const r = runRealityCheck({
      plausibility: HIGH,
      evidenceQuality: HIGH,
      consistency: HIGH,
      impossibleDelta: true,
    });
    expect(r.status).toBe(VerificationStatus.REJECTED_AS_INCONSISTENT);
  });

  it("will not verify on duplicate evidence (it can't be fresh proof)", () => {
    const r = runRealityCheck({
      plausibility: HIGH,
      evidenceQuality: HIGH,
      consistency: HIGH,
      duplicateEvidence: true,
    });
    expect(r.status).not.toBe(VerificationStatus.VERIFIED);
    expect(r.evidenceQuality).toBe(LOW);
  });
});

describe("runRealityCheck — anti-injection guarantee (§7)", () => {
  // The engine only sees structured signals, never text. Weak evidence (where any
  // injected "mark this verified" instruction would live) can never verify — no
  // string input to this function could change that.
  it("cannot reach VERIFIED from weak evidence no matter the other signals", () => {
    const attempts = [
      { plausibility: HIGH, evidenceQuality: LOW, consistency: HIGH },
      { plausibility: HIGH, evidenceQuality: LOW, consistency: LOW },
      { plausibility: LOW, evidenceQuality: LOW, consistency: LOW },
    ] as const;
    for (const signals of attempts) {
      expect(runRealityCheck(signals).status).not.toBe(VerificationStatus.VERIFIED);
    }
  });
});

describe("runRealityCheck — non-accusatory reasoning (§6.3)", () => {
  it("never uses accusation language across any outcome", () => {
    const cases = [
      runRealityCheck({ plausibility: HIGH, evidenceQuality: HIGH, consistency: HIGH }),
      runRealityCheck({ plausibility: LOW, evidenceQuality: LOW, consistency: LOW }),
      runRealityCheck({ plausibility: MEDIUM, evidenceQuality: MEDIUM, consistency: LOW }),
      runRealityCheck({ contradiction: true }),
      runRealityCheck({ impossibleDelta: true, plausibility: HIGH }),
      runRealityCheck({ duplicateEvidence: true, evidenceQuality: HIGH }),
    ];
    for (const r of cases) {
      expect(r.reasoning).not.toMatch(ACCUSATORY);
      expect(r.reasoning.length).toBeGreaterThan(0);
    }
  });

  it("frames an unverified result as 'not confirmable', not as wrongdoing", () => {
    const r = runRealityCheck({ plausibility: LOW, evidenceQuality: LOW, consistency: LOW });
    expect(r.reasoning.toLowerCase()).toContain("verif");
    expect(r.reasoning).not.toMatch(ACCUSATORY);
  });
});
