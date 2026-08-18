import { parseAbi } from "viem";

/**
 * `CommitmentVault` ABI — the typed contract surface the backend reads and encodes
 * against (build sequence §14.8).
 *
 * Transcribed faithfully, by hand, from `contracts/src/CommitmentVault.sol` (there is
 * no compiled Foundry artifact in this repo — `contracts/out/` is gitignored). Because
 * a wrong signature here would silently mis-encode a real transaction, the transcription
 * is verified in `abi.test.ts`: every function/error selector and event topic is
 * recomputed from these signatures and checked, so a drift from the Solidity source
 * fails the suite rather than reaching the chain.
 *
 * Solidity enums (`CommitmentStatus`) are `uint8` on the wire; see `COMMITMENT_STATUS`
 * below for the index→name mapping that mirrors the enum's declaration order.
 */

export const commitmentVaultAbiSignatures = [
  // --- structs (ABI tuple layouts; field order mirrors the Solidity structs) ---
  "struct Commitment { uint256 goalId; address depositor; address rewardFunder; uint256 principalAmount; uint256 rewardAmount; uint64 deadline; uint64 gracePeriod; uint64 createdAt; uint16 confidenceThreshold; uint8 status; bool rewardFunded; bool principalWithdrawn; bool rewardWithdrawn; bytes32 verificationHash; uint16 attestedConfidence; }",
  "struct Goal { address owner; uint64 registeredAt; bytes32 goalHash; }",
  "struct MilestoneRecord { bytes32 milestoneRef; bytes32 verificationHash; uint64 registeredAt; uint16 confidence; }",

  // --- public state / constants ---
  "function attestor() view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function nextGoalId() view returns (uint256)",
  "function nextCommitmentId() view returns (uint256)",
  "function MAX_GRACE_PERIOD() view returns (uint64)",
  "function commitmentOfGoal(uint256 goalId) view returns (uint256)",

  // --- admin (owner-only): the entire admin surface is naming the attestor ---
  "function setAttestor(address newAttestor)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function renounceOwnership()",

  // --- attestor- or owner-callable anchoring (no funds move) ---
  "function registerGoal(bytes32 goalHash) returns (uint256 goalId)",
  "function registerMilestone(uint256 goalId, bytes32 milestoneRef, bytes32 verificationHash, uint16 confidence)",

  // --- commitment lifecycle ---
  "function createCommitment(uint256 goalId, uint256 principalAmount, uint256 rewardAmount, uint64 deadline, uint64 gracePeriod, uint16 confidenceThreshold) returns (uint256 commitmentId)",
  "function fundReward(uint256 commitmentId) payable",
  "function lockFunds(uint256 commitmentId) payable",
  "function requestCompletion(uint256 commitmentId, bytes32 verificationHash)",
  "function approveCompletion(uint256 commitmentId, bytes32 verificationHash, uint16 confidence)",

  // --- depositor-only, pull-based withdrawals ---
  "function releasePrincipal(uint256 commitmentId)",
  "function claimReward(uint256 commitmentId)",
  "function cancelCommitment(uint256 commitmentId)",

  // --- views ---
  "function getCommitment(uint256 commitmentId) view returns (Commitment)",
  "function getCommitmentStatus(uint256 commitmentId) view returns (uint8)",
  "function getGoal(uint256 goalId) view returns (Goal)",
  "function getWalletGoals(address wallet) view returns (uint256[])",
  "function getWalletCommitments(address wallet) view returns (uint256[])",
  "function getMilestones(uint256 goalId) view returns (MilestoneRecord[])",
  "function milestoneCount(uint256 goalId) view returns (uint256)",
  "function cancellationOpensAt(uint256 commitmentId) view returns (uint64)",

  // --- events (the on-chain record permitted by the §9 privacy model) ---
  "event AttestorUpdated(address indexed previousAttestor, address indexed newAttestor)",
  "event GoalRegistered(uint256 indexed goalId, address indexed owner, bytes32 goalHash)",
  "event MilestoneRegistered(uint256 indexed goalId, bytes32 indexed milestoneRef, bytes32 verificationHash, uint16 confidence)",
  "event CommitmentCreated(uint256 indexed commitmentId, uint256 indexed goalId, address indexed depositor, uint256 principalAmount, uint256 rewardAmount, uint64 deadline, uint64 gracePeriod, uint16 confidenceThreshold)",
  "event RewardFunded(uint256 indexed commitmentId, address indexed funder, uint256 amount)",
  "event FundsLocked(uint256 indexed commitmentId, address indexed depositor, uint256 amount)",
  "event CompletionRequested(uint256 indexed commitmentId, address indexed requester, bytes32 verificationHash)",
  "event CompletionApproved(uint256 indexed commitmentId, bytes32 verificationHash, uint16 confidence)",
  "event PrincipalReleased(uint256 indexed commitmentId, address indexed depositor, uint256 amount)",
  "event RewardClaimed(uint256 indexed commitmentId, address indexed depositor, uint256 amount)",
  "event CommitmentCancelled(uint256 indexed commitmentId, address indexed depositor, uint256 principalReturned, uint256 rewardReturned)",

  // --- custom errors (decoded from reverts) ---
  "error ZeroAddress()",
  "error NotAttestor(address caller)",
  "error NotDepositor(address caller)",
  "error NotGoalOwner(address caller)",
  "error UnknownGoal(uint256 goalId)",
  "error UnknownCommitment(uint256 commitmentId)",
  "error GoalAlreadyCommitted(uint256 goalId)",
  "error InvalidStatus(uint8 actual)",
  "error ZeroPrincipal()",
  "error IncorrectValue(uint256 expected, uint256 sent)",
  "error DeadlineInPast(uint64 deadline, uint64 currentTime)",
  "error GracePeriodTooLong(uint64 gracePeriod, uint64 maximum)",
  "error InvalidConfidenceThreshold(uint16 threshold)",
  "error ConfidenceBelowThreshold(uint16 confidence, uint16 threshold)",
  "error EmptyVerificationHash()",
  "error RewardAlreadyFunded()",
  "error RewardNotFunded()",
  "error NoRewardConfigured()",
  "error AlreadyWithdrawn()",
  "error CancellationNotYetOpen(uint64 opensAt, uint64 currentTime)",
  "error TransferFailed(address to, uint256 amount)",
] as const;

/** The parsed, typed ABI used everywhere for reads and calldata encoding. */
export const commitmentVaultAbi = parseAbi(commitmentVaultAbiSignatures);

/**
 * `CommitmentStatus` enum, index-aligned with the Solidity declaration. A view that
 * returns the raw `uint8` is mapped through this to a human name for the UI/logs.
 */
export const COMMITMENT_STATUS = [
  "None",
  "Created",
  "Active",
  "CompletionRequested",
  "Approved",
  "Cancelled",
  "Closed",
] as const;

export type CommitmentStatusName = (typeof COMMITMENT_STATUS)[number];

/** Map a raw on-chain status byte to its name (`"Unknown"` if out of range). */
export function commitmentStatusName(raw: number | bigint): CommitmentStatusName | "Unknown" {
  const index = Number(raw);
  return COMMITMENT_STATUS[index] ?? "Unknown";
}
