/**
 * Evidence-pipeline domain errors (LIMITATIONS §13, item 10 content hardening).
 *
 * Thrown by the hardening boundary in `lib/evidence/hardening/` and mapped to a
 * status by `toHttpError` (the same idiom `lib/db/errors.ts` uses): the library
 * layer never imports HTTP concerns, and the route never re-derives policy.
 *
 * Fail-closed by construction: when the malware scanner is CONFIGURED but cannot
 * be reached, the upload is refused (503) rather than stored unscanned.
 */

/** 415 — the bytes are not what they claim to be, or are a type we refuse to store. */
export class EvidenceContentRejectedError extends Error {
  readonly code = "EVIDENCE_CONTENT_REJECTED" as const;
  /** Machine-readable reason, safe to return to the uploader. */
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "EvidenceContentRejectedError";
    this.reason = reason;
  }
}

/** 422 — a configured malware scanner matched a signature in the upload. */
export class EvidenceMalwareDetectedError extends Error {
  readonly code = "EVIDENCE_MALWARE_DETECTED" as const;
  readonly signature: string;
  readonly scanner: string;
  constructor(scanner: string, signature: string) {
    super(`evidence rejected by malware scan (${scanner}): ${signature}`);
    this.name = "EvidenceMalwareDetectedError";
    this.scanner = scanner;
    this.signature = signature;
  }
}

/**
 * 503 — a malware scanner is configured but did not produce a verdict (down,
 * timed out, or answered with a protocol error). The upload is refused: storing
 * an unscanned blob while claiming scanning is enabled would be a fake (rule 1).
 */
export class EvidenceScanUnavailableError extends Error {
  readonly code = "EVIDENCE_SCAN_UNAVAILABLE" as const;
  readonly scanner: string;
  constructor(scanner: string, detail: string) {
    super(`evidence malware scan unavailable (${scanner}): ${detail}`);
    this.name = "EvidenceScanUnavailableError";
    this.scanner = scanner;
  }
}
