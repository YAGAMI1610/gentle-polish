/**
 * Evidence content hardening (LIMITATIONS §13, item 10): deep content sniffing,
 * a pluggable malware-scanning hook, and image metadata/EXIF scrubbing, all applied
 * at the single choke point `storeEvidence` calls.
 */
export { hardenEvidenceBytes } from "./harden";
export type { EvidenceHardeningReport, HardenedEvidence, HardenEvidenceOptions } from "./harden";
export { assertSniffedContentAllowed, normaliseMime, sniffContent } from "./sniff";
export type { SniffDecision, SniffedKind, SniffedType } from "./sniff";
export { scrubImageMetadata } from "./metadata";
export type { MetadataScrubResult } from "./metadata";
export {
  createMalwareScanner,
  getMalwareScanner,
  readMalwareScanConfig,
  __resetMalwareScannerForTests,
} from "./scanner";
export type {
  MalwareScanner,
  MalwareScanSettings,
  MalwareScanTarget,
  MalwareScanVerdict,
} from "./scanner";
export { ClamdScanner, parseClamdReply } from "./clamd";
export type { ClamdConfig } from "./clamd";
