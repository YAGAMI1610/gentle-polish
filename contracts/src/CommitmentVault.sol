// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title CommitmentVault
/// @notice Escrow for CommitAI self-commitments: a user locks their own funds against a
///         personal goal, an off-chain verification service attests when the goal is met,
///         and the user withdraws. Also anchors goal and milestone verification hashes
///         on-chain for accountability-only (no-funds) goals.
///
/// ============================================================================
/// MONEY-SAFETY INVARIANTS — the reason this contract is shaped the way it is
/// ============================================================================
///
/// I1. Principal is only ever payable to `commitment.depositor`. There is no other
///     destination in any code path, on any outcome, for any caller.
/// I2. Reward is only ever payable to `commitment.depositor` (on attested success) or
///     back to `commitment.rewardFunder` (on cancellation). Never anywhere else.
/// I3. No function that changes a balance can be called by the owner or the attestor.
///     Fund movement is depositor-only, always. The owner's sole power is naming the
///     attestor address; the attestor's sole power is attesting.
/// I4. There is no slashing, no forfeiture, no admin seizure, no sweep, and no pause.
///     A pause is deliberately absent: a pause that could block a withdrawal would be
///     a freeze on funds that are not ours to freeze.
/// I5. `rewardAmount` and `confidenceThreshold` are written once, in
///     `createCommitment`, and there is no setter for either. Neither the owner nor
///     the attestor can change the terms a depositor signed up to.
/// I6. Every commitment has a terminal exit that does not depend on the attestor
///     existing, being online, or cooperating — see `cancelCommitment`. Funds cannot
///     be stranded by backend failure.
///
/// The AI never holds a key that can move money. It can propose (`requestCompletion`)
/// and attest (`approveCompletion`), and attesting only flips a flag. Every transfer is
/// pulled by the depositor in a separate transaction they sign themselves. That is the
/// whole point of the pull pattern here: it means a compromised attestor key cannot
/// send funds anywhere, because no attestor-reachable function transfers value.
///
/// ============================================================================
/// TRUST MODEL for `approveCompletion` — build prompt section 8
/// ============================================================================
///
/// Section 8 asks for either (a) an attestor role held by the backend service wallet,
/// or (b) a time-locked user self-attestation fallback. This contract implements (a)
/// and deliberately does NOT implement (b). The reasoning, because this is exactly the
/// spot most likely to be simplified badly:
///
///   - The stated purpose of a fallback is to stop a depositor being trapped if the
///     backend disappears. Here they cannot be trapped: `cancelCommitment` returns
///     100% of principal with no attestor involvement at all (I6).
///   - So the only thing self-attestation would additionally unlock is the *reward*.
///     Since a reward may be funded by a third-party sponsor, a self-attestation path
///     would let a depositor take a sponsor's money by asserting their own success
///     after a timer — no verification, no consent. That is a fund-safety hole, not a
///     convenience feature.
///   - Therefore: worst case for a depositor whose attestor never responds is that
///     they reclaim their full principal and the sponsor reclaims the full reward.
///     Nobody is seized from, nothing is stranded, and no unverified reward is paid.
///
/// What the attestor CAN do at worst, if its key is stolen: approve a completion that
/// was not real, which lets that specific depositor withdraw their own principal early
/// and take a reward their sponsor funded. It cannot redirect a single wei to the
/// attacker. Production hardening — a multi-sig or threshold attestor, and per-approval
/// signed verification receipts — is recorded in LIMITATIONS.md.
contract CommitmentVault is ReentrancyGuard, Ownable2Step {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum CommitmentStatus {
        None, // does not exist
        Created, // terms fixed; principal not yet locked
        Active, // principal locked; goal in progress
        CompletionRequested, // completion proposed; awaiting attestation
        Approved, // attested complete; payouts unlocked
        Cancelled, // non-punitive exit; principal reclaimable
        Closed // every funded leg withdrawn
    }

    struct Commitment {
        uint256 goalId;
        address depositor; // sole possible recipient of principal (I1)
        address rewardFunder; // sole possible refund recipient of reward (I2)
        uint256 principalAmount;
        uint256 rewardAmount; // write-once (I5)
        uint64 deadline; // 0 == open-ended goal
        uint64 gracePeriod; // seconds after deadline before cancellation opens
        uint64 createdAt;
        uint16 confidenceThreshold; // 1..100, write-once (I5)
        CommitmentStatus status;
        bool rewardFunded;
        bool principalWithdrawn;
        bool rewardWithdrawn;
        bytes32 verificationHash; // hash attested at approval; never raw evidence
        uint16 attestedConfidence;
    }

    struct Goal {
        address owner;
        uint64 registeredAt;
        bytes32 goalHash; // hash of off-chain goal record; never plaintext
    }

    struct MilestoneRecord {
        bytes32 milestoneRef; // opaque off-chain milestone id
        bytes32 verificationHash; // sha256 of the verification result (section 6.5)
        uint64 registeredAt;
        uint16 confidence;
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    /// @notice Backend service wallet permitted to attest verification outcomes.
    /// @dev Holds no spending power whatsoever — see I3.
    address public attestor;

    uint256 public nextGoalId = 1;
    uint256 public nextCommitmentId = 1;

    /// @notice Upper bound on `gracePeriod`, so a mistyped grace cannot lock a
    ///         depositor out of their own money for an unreasonable stretch.
    uint64 public constant MAX_GRACE_PERIOD = 180 days;

    mapping(uint256 goalId => Goal) private _goals;
    mapping(uint256 goalId => MilestoneRecord[]) private _milestones;
    mapping(uint256 commitmentId => Commitment) private _commitments;
    mapping(address wallet => uint256[] goalIds) private _goalsByWallet;
    mapping(address wallet => uint256[] commitmentIds) private _commitmentsByWallet;
    mapping(uint256 goalId => uint256 commitmentId) public commitmentOfGoal;

    // -------------------------------------------------------------------------
    // Events — the on-chain record permitted by the privacy model (section 9)
    // -------------------------------------------------------------------------

    event AttestorUpdated(address indexed previousAttestor, address indexed newAttestor);
    event GoalRegistered(uint256 indexed goalId, address indexed owner, bytes32 goalHash);
    event MilestoneRegistered(
        uint256 indexed goalId, bytes32 indexed milestoneRef, bytes32 verificationHash, uint16 confidence
    );
    event CommitmentCreated(
        uint256 indexed commitmentId,
        uint256 indexed goalId,
        address indexed depositor,
        uint256 principalAmount,
        uint256 rewardAmount,
        uint64 deadline,
        uint64 gracePeriod,
        uint16 confidenceThreshold
    );
    event RewardFunded(uint256 indexed commitmentId, address indexed funder, uint256 amount);
    event FundsLocked(uint256 indexed commitmentId, address indexed depositor, uint256 amount);
    event CompletionRequested(uint256 indexed commitmentId, address indexed requester, bytes32 verificationHash);
    event CompletionApproved(uint256 indexed commitmentId, bytes32 verificationHash, uint16 confidence);
    event PrincipalReleased(uint256 indexed commitmentId, address indexed depositor, uint256 amount);
    event RewardClaimed(uint256 indexed commitmentId, address indexed depositor, uint256 amount);
    event CommitmentCancelled(
        uint256 indexed commitmentId, address indexed depositor, uint256 principalReturned, uint256 rewardReturned
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ZeroAddress();
    error NotAttestor(address caller);
    error NotDepositor(address caller);
    error NotGoalOwner(address caller);
    error UnknownGoal(uint256 goalId);
    error UnknownCommitment(uint256 commitmentId);
    error GoalAlreadyCommitted(uint256 goalId);
    error InvalidStatus(CommitmentStatus actual);
    error ZeroPrincipal();
    error IncorrectValue(uint256 expected, uint256 sent);
    error DeadlineInPast(uint64 deadline, uint64 now_);
    error GracePeriodTooLong(uint64 gracePeriod, uint64 maximum);
    error InvalidConfidenceThreshold(uint16 threshold);
    error ConfidenceBelowThreshold(uint16 confidence, uint16 threshold);
    error EmptyVerificationHash();
    error RewardAlreadyFunded();
    error RewardNotFunded();
    error NoRewardConfigured();
    error AlreadyWithdrawn();
    error CancellationNotYetOpen(uint64 opensAt, uint64 now_);
    error TransferFailed(address to, uint256 amount);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyAttestor() {
        if (msg.sender != attestor) revert NotAttestor(msg.sender);
        _;
    }

    /// @param initialOwner Address allowed to name the attestor. Has no spending power.
    /// @param initialAttestor Backend service wallet allowed to attest. No spending power.
    constructor(address initialOwner, address initialAttestor) Ownable(initialOwner) {
        if (initialOwner == address(0) || initialAttestor == address(0)) revert ZeroAddress();
        attestor = initialAttestor;
        emit AttestorUpdated(address(0), initialAttestor);
    }

    // -------------------------------------------------------------------------
    // Admin — deliberately limited to naming the attestor
    // -------------------------------------------------------------------------

    /// @notice Rotate the attestor key.
    /// @dev This is the *entire* admin surface. Note what it cannot do: it cannot move
    ///      funds, cannot alter any commitment's terms, cannot approve a completion,
    ///      and cannot block a withdrawal. Rotating a compromised attestor key is a
    ///      safety operation, which is why it exists.
    function setAttestor(address newAttestor) external onlyOwner {
        if (newAttestor == address(0)) revert ZeroAddress();
        address previous = attestor;
        attestor = newAttestor;
        emit AttestorUpdated(previous, newAttestor);
    }

    // -------------------------------------------------------------------------
    // Mode A — accountability-only anchoring (no funds involved)
    // -------------------------------------------------------------------------

    /// @notice Anchor a goal on-chain. Available with or without a financial commitment,
    ///         so accountability-only goals still get a verifiable timestamp.
    /// @param goalHash Hash of the off-chain goal record. Never the goal text itself.
    function registerGoal(bytes32 goalHash) external returns (uint256 goalId) {
        if (goalHash == bytes32(0)) revert EmptyVerificationHash();

        goalId = nextGoalId++;
        _goals[goalId] = Goal({owner: msg.sender, registeredAt: uint64(block.timestamp), goalHash: goalHash});
        _goalsByWallet[msg.sender].push(goalId);

        emit GoalRegistered(goalId, msg.sender, goalHash);
    }

    /// @notice Anchor a milestone verification result against a goal.
    /// @dev Callable by the attestor (normal path: the AI verified a milestone) or by the
    ///      goal owner (self-recorded progress). Stores only a hash — never the evidence
    ///      itself, per the privacy model in section 9. Moves no funds.
    function registerMilestone(
        uint256 goalId,
        bytes32 milestoneRef,
        bytes32 verificationHash,
        uint16 confidence
    ) external {
        Goal storage goal = _goals[goalId];
        if (goal.owner == address(0)) revert UnknownGoal(goalId);
        if (msg.sender != attestor && msg.sender != goal.owner) revert NotAttestor(msg.sender);
        if (verificationHash == bytes32(0)) revert EmptyVerificationHash();

        _milestones[goalId].push(
            MilestoneRecord({
                milestoneRef: milestoneRef,
                verificationHash: verificationHash,
                registeredAt: uint64(block.timestamp),
                confidence: confidence
            })
        );

        emit MilestoneRegistered(goalId, milestoneRef, verificationHash, confidence);
    }

    // -------------------------------------------------------------------------
    // Mode B — self-commitment lifecycle
    // -------------------------------------------------------------------------

    /// @notice Fix the terms of a self-commitment. Locks nothing; see `lockFunds`.
    /// @dev `rewardAmount` and `confidenceThreshold` are written here and never again —
    ///      there is no setter for either (I5). The depositor therefore knows the exact
    ///      terms, including the confidence bar for approval, before they send any money.
    /// @param goalId Goal to bind to, previously created by `registerGoal` by this caller.
    /// @param principalAmount Exact wei the depositor will lock via `lockFunds`.
    /// @param rewardAmount Bonus payable on attested success. May be 0. Funded separately
    ///        by `fundReward`, possibly by a third-party sponsor.
    /// @param deadline Unix seconds; 0 means open-ended.
    /// @param gracePeriod Seconds after `deadline` before cancellation opens.
    /// @param confidenceThreshold Minimum verification confidence (1..100) the attestor
    ///        must meet to approve. Enforced by the contract, not by the backend.
    function createCommitment(
        uint256 goalId,
        uint256 principalAmount,
        uint256 rewardAmount,
        uint64 deadline,
        uint64 gracePeriod,
        uint16 confidenceThreshold
    ) external returns (uint256 commitmentId) {
        Goal storage goal = _goals[goalId];
        if (goal.owner == address(0)) revert UnknownGoal(goalId);
        if (goal.owner != msg.sender) revert NotGoalOwner(msg.sender);
        if (commitmentOfGoal[goalId] != 0) revert GoalAlreadyCommitted(goalId);
        if (principalAmount == 0) revert ZeroPrincipal();
        // Deadlines are wall-clock by definition. A validator skewing the timestamp by
        // seconds cannot do anything meaningful to a deadline set days or weeks out, and
        // the only effect here is rejecting a deadline that has already passed.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline != 0 && deadline <= block.timestamp) revert DeadlineInPast(deadline, uint64(block.timestamp));
        if (gracePeriod > MAX_GRACE_PERIOD) revert GracePeriodTooLong(gracePeriod, MAX_GRACE_PERIOD);
        if (confidenceThreshold == 0 || confidenceThreshold > 100) {
            revert InvalidConfidenceThreshold(confidenceThreshold);
        }

        commitmentId = nextCommitmentId++;
        Commitment storage c = _commitments[commitmentId];
        c.goalId = goalId;
        c.depositor = msg.sender;
        c.principalAmount = principalAmount;
        c.rewardAmount = rewardAmount;
        c.deadline = deadline;
        c.gracePeriod = gracePeriod;
        c.createdAt = uint64(block.timestamp);
        c.confidenceThreshold = confidenceThreshold;
        c.status = CommitmentStatus.Created;

        commitmentOfGoal[goalId] = commitmentId;
        _commitmentsByWallet[msg.sender].push(commitmentId);

        emit CommitmentCreated(
            commitmentId, goalId, msg.sender, principalAmount, rewardAmount, deadline, gracePeriod, confidenceThreshold
        );
    }

    /// @notice Escrow the reward. Callable by anyone — the depositor themselves, or a
    ///         third-party sponsor backing them.
    /// @dev Must send exactly `rewardAmount`; this cannot be used to raise the reward
    ///      above the amount fixed at creation (I5). If the commitment is later
    ///      cancelled, this exact amount goes back to whoever called this (I2).
    function fundReward(uint256 commitmentId) external payable {
        Commitment storage c = _commitments[commitmentId];
        _requireExists(c, commitmentId);
        if (
            c.status != CommitmentStatus.Created && c.status != CommitmentStatus.Active
                && c.status != CommitmentStatus.CompletionRequested
        ) {
            revert InvalidStatus(c.status);
        }
        if (c.rewardAmount == 0) revert NoRewardConfigured();
        if (c.rewardFunded) revert RewardAlreadyFunded();
        if (msg.value != c.rewardAmount) revert IncorrectValue(c.rewardAmount, msg.value);

        c.rewardFunded = true;
        c.rewardFunder = msg.sender;

        emit RewardFunded(commitmentId, msg.sender, msg.value);
    }

    /// @notice Lock the principal. This is the depositor's own signed deposit — the only
    ///         way funds ever enter a commitment on their behalf.
    function lockFunds(uint256 commitmentId) external payable {
        Commitment storage c = _commitments[commitmentId];
        _requireExists(c, commitmentId);
        if (msg.sender != c.depositor) revert NotDepositor(msg.sender);
        if (c.status != CommitmentStatus.Created) revert InvalidStatus(c.status);
        if (msg.value != c.principalAmount) revert IncorrectValue(c.principalAmount, msg.value);

        c.status = CommitmentStatus.Active;

        emit FundsLocked(commitmentId, msg.sender, msg.value);
    }

    /// @notice Propose that a commitment's goal is complete and ready for attestation.
    /// @dev Callable by the attestor (the AI reached this conclusion) or by the depositor
    ///      (asking to be assessed). Moves no funds and unlocks nothing on its own.
    function requestCompletion(uint256 commitmentId, bytes32 verificationHash) external {
        Commitment storage c = _commitments[commitmentId];
        _requireExists(c, commitmentId);
        if (msg.sender != attestor && msg.sender != c.depositor) revert NotAttestor(msg.sender);
        if (c.status != CommitmentStatus.Active) revert InvalidStatus(c.status);
        if (verificationHash == bytes32(0)) revert EmptyVerificationHash();

        c.status = CommitmentStatus.CompletionRequested;
        c.verificationHash = verificationHash;

        emit CompletionRequested(commitmentId, msg.sender, verificationHash);
    }

    /// @notice Attest that verification succeeded, unlocking the depositor's withdrawals.
    /// @dev Attestor-only, and it transfers nothing — it flips a flag. The depositor then
    ///      pulls principal and reward in transactions they sign themselves. A stolen
    ///      attestor key therefore cannot direct funds to an attacker (I3).
    ///
    ///      `confidence` is checked against the threshold the depositor fixed at creation,
    ///      so the bar is enforced on-chain rather than trusted to the backend.
    function approveCompletion(uint256 commitmentId, bytes32 verificationHash, uint16 confidence)
        external
        onlyAttestor
    {
        Commitment storage c = _commitments[commitmentId];
        _requireExists(c, commitmentId);
        if (c.status != CommitmentStatus.CompletionRequested) revert InvalidStatus(c.status);
        if (verificationHash == bytes32(0)) revert EmptyVerificationHash();
        if (confidence < c.confidenceThreshold) {
            revert ConfidenceBelowThreshold(confidence, c.confidenceThreshold);
        }

        c.status = CommitmentStatus.Approved;
        c.verificationHash = verificationHash;
        c.attestedConfidence = confidence;

        emit CompletionApproved(commitmentId, verificationHash, confidence);
    }

    // -------------------------------------------------------------------------
    // Withdrawals — depositor-only, pull-based, one-shot
    // -------------------------------------------------------------------------

    /// @notice Withdraw the principal after an attested success.
    /// @dev Depositor-only, and pays the depositor. For the unsuccessful or abandoned
    ///      case use `cancelCommitment`, which returns the same 100% of principal.
    function releasePrincipal(uint256 commitmentId) external nonReentrant {
        Commitment storage c = _commitments[commitmentId];
        _requireExists(c, commitmentId);
        if (msg.sender != c.depositor) revert NotDepositor(msg.sender);
        if (c.status != CommitmentStatus.Approved) revert InvalidStatus(c.status);
        if (c.principalWithdrawn) revert AlreadyWithdrawn();

        c.principalWithdrawn = true;
        uint256 amount = c.principalAmount;
        _closeIfDrained(c);

        emit PrincipalReleased(commitmentId, c.depositor, amount);
        _send(c.depositor, amount);
    }

    /// @notice Withdraw the reward after an attested success.
    function claimReward(uint256 commitmentId) external nonReentrant {
        Commitment storage c = _commitments[commitmentId];
        _requireExists(c, commitmentId);
        if (msg.sender != c.depositor) revert NotDepositor(msg.sender);
        if (c.status != CommitmentStatus.Approved) revert InvalidStatus(c.status);
        if (c.rewardAmount == 0) revert NoRewardConfigured();
        if (!c.rewardFunded) revert RewardNotFunded();
        if (c.rewardWithdrawn) revert AlreadyWithdrawn();

        c.rewardWithdrawn = true;
        uint256 amount = c.rewardAmount;
        _closeIfDrained(c);

        emit RewardClaimed(commitmentId, c.depositor, amount);
        _send(c.depositor, amount);
    }

    /// @notice The non-punitive exit. Returns 100% of principal to the depositor and any
    ///         escrowed reward to whoever funded it.
    ///
    /// @dev This is the guarantee that makes the whole design safe to sign up to:
    ///      - Nothing is withheld, deducted, slashed or redirected. Not a wei goes to an
    ///        admin, to the attestor, to the contract, or to anyone but the two people
    ///        who put money in.
    ///      - It needs no attestation, so it works even if the backend is gone forever.
    ///      - Failing the goal and abandoning the goal are the same path. There is no
    ///        code that treats "failed" worse than "changed my mind".
    ///
    ///      Timing: for a deadline goal, cancellation opens at `deadline + gracePeriod` —
    ///      the lock-up the depositor deliberately chose, and the only thing giving a
    ///      commitment device its teeth. For an open-ended goal (`deadline == 0`) it is
    ///      open immediately. Before any principal is locked it is always open.
    function cancelCommitment(uint256 commitmentId) external nonReentrant {
        Commitment storage c = _commitments[commitmentId];
        _requireExists(c, commitmentId);
        if (msg.sender != c.depositor) revert NotDepositor(msg.sender);
        if (c.status != CommitmentStatus.Created && c.status != CommitmentStatus.Active
            && c.status != CommitmentStatus.CompletionRequested) {
            revert InvalidStatus(c.status);
        }

        // A locked deadline goal must wait out the grace period. Nothing locked yet
        // means nothing to wait for.
        if (c.status != CommitmentStatus.Created && c.deadline != 0) {
            uint64 opensAt = c.deadline + c.gracePeriod;
            // Same reasoning as in `createCommitment`. Worst case a validator moves the
            // cancellation window by a few seconds at the end of a grace period measured
            // in days, and the direction of that skew cannot take funds from anyone —
            // the only outcome either way is the depositor getting their own money back.
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp < opensAt) revert CancellationNotYetOpen(opensAt, uint64(block.timestamp));
        }

        uint256 principalReturned = 0;
        if (c.status != CommitmentStatus.Created && !c.principalWithdrawn) {
            c.principalWithdrawn = true;
            principalReturned = c.principalAmount;
        }

        uint256 rewardReturned = 0;
        address rewardFunder = c.rewardFunder;
        if (c.rewardFunded && !c.rewardWithdrawn) {
            c.rewardWithdrawn = true;
            rewardReturned = c.rewardAmount;
        }

        c.status = CommitmentStatus.Cancelled;

        emit CommitmentCancelled(commitmentId, c.depositor, principalReturned, rewardReturned);

        // Reward goes back to its funder, principal to the depositor (I2, I1).
        if (rewardReturned > 0) _send(rewardFunder, rewardReturned);
        if (principalReturned > 0) _send(c.depositor, principalReturned);
    }

    // -------------------------------------------------------------------------
    // Views — read paths for the backend and the AI's chain-reading tools
    // -------------------------------------------------------------------------

    function getCommitment(uint256 commitmentId) external view returns (Commitment memory) {
        Commitment storage c = _commitments[commitmentId];
        if (c.status == CommitmentStatus.None) revert UnknownCommitment(commitmentId);
        return c;
    }

    /// @notice Backing read for the `getCommitmentStatus` agent tool (section 4).
    function getCommitmentStatus(uint256 commitmentId) external view returns (CommitmentStatus) {
        return _commitments[commitmentId].status;
    }

    function getGoal(uint256 goalId) external view returns (Goal memory) {
        Goal storage goal = _goals[goalId];
        if (goal.owner == address(0)) revert UnknownGoal(goalId);
        return goal;
    }

    /// @notice Backing read for the `getWalletGoals` agent tool (section 4).
    function getWalletGoals(address wallet) external view returns (uint256[] memory) {
        return _goalsByWallet[wallet];
    }

    function getWalletCommitments(address wallet) external view returns (uint256[] memory) {
        return _commitmentsByWallet[wallet];
    }

    function getMilestones(uint256 goalId) external view returns (MilestoneRecord[] memory) {
        return _milestones[goalId];
    }

    function milestoneCount(uint256 goalId) external view returns (uint256) {
        return _milestones[goalId].length;
    }

    /// @notice When `cancelCommitment` becomes callable. 0 means "already open".
    function cancellationOpensAt(uint256 commitmentId) external view returns (uint64) {
        Commitment storage c = _commitments[commitmentId];
        if (c.status == CommitmentStatus.None) revert UnknownCommitment(commitmentId);
        if (c.status == CommitmentStatus.Created || c.deadline == 0) return 0;
        return c.deadline + c.gracePeriod;
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    function _requireExists(Commitment storage c, uint256 commitmentId) private view {
        if (c.status == CommitmentStatus.None) revert UnknownCommitment(commitmentId);
    }

    /// @dev Mark a commitment closed once every leg that was funded has been withdrawn.
    function _closeIfDrained(Commitment storage c) private {
        bool rewardOutstanding = c.rewardFunded && !c.rewardWithdrawn;
        if (c.principalWithdrawn && !rewardOutstanding) {
            c.status = CommitmentStatus.Closed;
        }
    }

    /// @dev State is always updated before this is reached, and every caller is
    ///      `nonReentrant`, so a re-entering recipient finds nothing left to take.
    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed(to, amount);
    }
}
