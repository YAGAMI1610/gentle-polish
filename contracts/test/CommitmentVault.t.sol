// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CommitmentVault} from "../src/CommitmentVault.sol";
import {ReentrantAttacker, RejectingReceiver} from "./Attackers.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CommitmentVault test suite
/// @notice Covers the build-prompt section 8 checklist (happy path, cancel path,
///         reentrancy, unauthorized approve, double-claim, wrong-caller release) plus
///         the money-safety invariants the contract's header documents.
contract CommitmentVaultTest is Test {
    CommitmentVault internal vault;

    address internal owner = makeAddr("owner");
    address internal attestor = makeAddr("attestor");
    address internal depositor = makeAddr("depositor");
    address internal sponsor = makeAddr("sponsor");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant GOAL_HASH = keccak256("goal:read-10-books");
    bytes32 internal constant VERIF_HASH = keccak256("verification-result-1");
    uint256 internal constant PRINCIPAL = 20 ether;
    uint256 internal constant REWARD = 2 ether;
    uint16 internal constant THRESHOLD = 80;

    // Mirror of the contract's events, for expectEmit.
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
    event FundsLocked(uint256 indexed commitmentId, address indexed depositor, uint256 amount);
    event CompletionApproved(uint256 indexed commitmentId, bytes32 verificationHash, uint16 confidence);
    event PrincipalReleased(uint256 indexed commitmentId, address indexed depositor, uint256 amount);
    event RewardClaimed(uint256 indexed commitmentId, address indexed depositor, uint256 amount);
    event CommitmentCancelled(
        uint256 indexed commitmentId, address indexed depositor, uint256 principalReturned, uint256 rewardReturned
    );

    function setUp() public {
        vm.prank(owner);
        vault = new CommitmentVault(owner, attestor);
        vm.deal(depositor, 100 ether);
        vm.deal(sponsor, 100 ether);
        vm.deal(stranger, 100 ether);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// @dev Register a goal and create a commitment as `depositor`, no funds locked yet.
    function _createCommitment(uint64 deadline, uint64 grace) internal returns (uint256 goalId, uint256 commitmentId) {
        vm.startPrank(depositor);
        goalId = vault.registerGoal(GOAL_HASH);
        commitmentId = vault.createCommitment(goalId, PRINCIPAL, REWARD, deadline, grace, THRESHOLD);
        vm.stopPrank();
    }

    /// @dev Full active commitment: goal + commitment + principal locked + reward funded.
    function _activeCommitment(uint64 deadline, uint64 grace)
        internal
        returns (uint256 goalId, uint256 commitmentId)
    {
        (goalId, commitmentId) = _createCommitment(deadline, grace);
        vm.prank(sponsor);
        vault.fundReward{value: REWARD}(commitmentId);
        vm.prank(depositor);
        vault.lockFunds{value: PRINCIPAL}(commitmentId);
    }

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    function test_constructor_setsOwnerAndAttestor() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.attestor(), attestor);
        assertEq(vault.nextGoalId(), 1);
        assertEq(vault.nextCommitmentId(), 1);
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new CommitmentVault(address(0), attestor);
    }

    function test_constructor_revertsOnZeroAttestor() public {
        vm.expectRevert(CommitmentVault.ZeroAddress.selector);
        new CommitmentVault(owner, address(0));
    }

    // -------------------------------------------------------------------------
    // Happy path — section 8 / section 15 demo flow
    // -------------------------------------------------------------------------

    function test_happyPath_lockApproveReleaseClaim() public {
        (, uint256 id) = _createCommitment(0, 0);

        // Reward funded by a third-party sponsor.
        vm.prank(sponsor);
        vault.fundReward{value: REWARD}(id);

        // Depositor locks their own principal.
        vm.expectEmit(true, true, false, true);
        emit FundsLocked(id, depositor, PRINCIPAL);
        vm.prank(depositor);
        vault.lockFunds{value: PRINCIPAL}(id);
        assertEq(address(vault).balance, PRINCIPAL + REWARD);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Active));

        // Completion requested by the attestor.
        vm.prank(attestor);
        vault.requestCompletion(id, VERIF_HASH);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.CompletionRequested));

        // Attestor approves at/above the threshold — flag flip only, no transfer.
        vm.expectEmit(true, false, false, true);
        emit CompletionApproved(id, VERIF_HASH, 92);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 92);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Approved));

        // Depositor pulls principal, then reward.
        uint256 balBefore = depositor.balance;

        vm.expectEmit(true, true, false, true);
        emit PrincipalReleased(id, depositor, PRINCIPAL);
        vm.prank(depositor);
        vault.releasePrincipal(id);

        vm.expectEmit(true, true, false, true);
        emit RewardClaimed(id, depositor, REWARD);
        vm.prank(depositor);
        vault.claimReward(id);

        assertEq(depositor.balance, balBefore + PRINCIPAL + REWARD);
        assertEq(address(vault).balance, 0);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Closed));
    }

    function test_happyPath_noReward() public {
        vm.startPrank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        uint256 id = vault.createCommitment(goalId, PRINCIPAL, 0, 0, 0, THRESHOLD);
        vault.lockFunds{value: PRINCIPAL}(id);
        vault.requestCompletion(id, VERIF_HASH);
        vm.stopPrank();

        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, THRESHOLD);

        // No reward configured → claimReward must revert, not send stray funds. Checked
        // here while still Approved: after releasePrincipal the sole funded leg is drained
        // and the commitment auto-closes, so the guard that fires would be the status one.
        vm.prank(depositor);
        vm.expectRevert(CommitmentVault.NoRewardConfigured.selector);
        vault.claimReward(id);

        // Releasing the principal drains the only funded leg → auto-close.
        uint256 balBefore = depositor.balance;
        vm.prank(depositor);
        vault.releasePrincipal(id);
        assertEq(depositor.balance, balBefore + PRINCIPAL);
        assertEq(address(vault).balance, 0);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Closed));
    }

    // -------------------------------------------------------------------------
    // Cancel path — non-punitive, full principal back (section 8, rule 2)
    // -------------------------------------------------------------------------

    function test_cancel_openEnded_returnsFullPrincipalAndReward() public {
        (, uint256 id) = _activeCommitment(0, 0);
        uint256 depBefore = depositor.balance;
        uint256 sponBefore = sponsor.balance;

        vm.expectEmit(true, true, false, true);
        emit CommitmentCancelled(id, depositor, PRINCIPAL, REWARD);
        vm.prank(depositor);
        vault.cancelCommitment(id);

        // 100% principal back to depositor, 100% reward back to its funder.
        assertEq(depositor.balance, depBefore + PRINCIPAL);
        assertEq(sponsor.balance, sponBefore + REWARD);
        assertEq(address(vault).balance, 0);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Cancelled));
    }

    function test_cancel_beforeLock_isAllowedImmediately() public {
        (, uint256 id) = _createCommitment(uint64(block.timestamp + 30 days), 1 days);
        // No funds locked yet: cancellation is open even with a future deadline.
        vm.prank(depositor);
        vault.cancelCommitment(id);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Cancelled));
    }

    function test_cancel_deadlineGoal_blockedUntilGraceElapses() public {
        uint64 deadline = uint64(block.timestamp + 30 days);
        uint64 grace = 7 days;
        (, uint256 id) = _activeCommitment(deadline, grace);

        // Too early — before deadline.
        vm.prank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(
                CommitmentVault.CancellationNotYetOpen.selector, deadline + grace, uint64(block.timestamp)
            )
        );
        vault.cancelCommitment(id);

        // Still too early — after deadline but inside grace.
        vm.warp(deadline + 1);
        vm.prank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(
                CommitmentVault.CancellationNotYetOpen.selector, deadline + grace, uint64(block.timestamp)
            )
        );
        vault.cancelCommitment(id);

        // Exactly at the boundary — allowed.
        vm.warp(deadline + grace);
        uint256 depBefore = depositor.balance;
        vm.prank(depositor);
        vault.cancelCommitment(id);
        assertEq(depositor.balance, depBefore + PRINCIPAL);
    }

    function test_cancel_afterCompletionRequested_stillAllowed() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);

        // Depositor changes their mind while awaiting attestation: still fully refundable.
        vm.prank(depositor);
        vault.cancelCommitment(id);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Cancelled));
    }

    function test_cancel_afterApproval_isRejected() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 90);

        // Once approved, the withdrawal path is release/claim, not cancel.
        vm.prank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(
                CommitmentVault.InvalidStatus.selector, CommitmentVault.CommitmentStatus.Approved
            )
        );
        vault.cancelCommitment(id);
    }

    function test_cancel_onlyDepositor() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotDepositor.selector, stranger));
        vault.cancelCommitment(id);

        // Not even the owner or attestor can trigger someone's cancel.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotDepositor.selector, owner));
        vault.cancelCommitment(id);

        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotDepositor.selector, attestor));
        vault.cancelCommitment(id);
    }

    // -------------------------------------------------------------------------
    // Reentrancy — section 8 / section 13
    // -------------------------------------------------------------------------

    function test_reentrancy_releasePrincipal_cannotDrain() public {
        ReentrantAttacker attacker = new ReentrantAttacker(vault);
        vm.deal(address(attacker), PRINCIPAL);
        vm.deal(sponsor, 100 ether);

        vm.prank(address(attacker));
        uint256 goalId = attacker.registerGoal(GOAL_HASH);
        vm.prank(address(attacker));
        uint256 id = attacker.createCommitment(goalId, PRINCIPAL, 0, 0, 0, THRESHOLD);
        vm.prank(address(attacker));
        attacker.lockFunds{value: PRINCIPAL}(id);
        vm.prank(address(attacker));
        attacker.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 90);

        attacker.setTarget(id, ReentrantAttacker.Target.ReleasePrincipal);

        // The re-entrant call reverts inside the guard; the outer call bubbles it up.
        vm.prank(address(attacker));
        vm.expectRevert();
        attacker.releasePrincipal(id);

        // Nothing drained: vault still holds exactly the principal.
        assertEq(address(vault).balance, PRINCIPAL);
        assertEq(address(attacker).balance, 0);
    }

    function test_reentrancy_cancel_cannotDrain() public {
        ReentrantAttacker attacker = new ReentrantAttacker(vault);
        vm.deal(address(attacker), PRINCIPAL);

        vm.prank(address(attacker));
        uint256 goalId = attacker.registerGoal(GOAL_HASH);
        vm.prank(address(attacker));
        uint256 id = attacker.createCommitment(goalId, PRINCIPAL, 0, 0, 0, THRESHOLD);
        vm.prank(address(attacker));
        attacker.lockFunds{value: PRINCIPAL}(id);

        attacker.setTarget(id, ReentrantAttacker.Target.Cancel);

        vm.prank(address(attacker));
        vm.expectRevert();
        attacker.cancel(id);

        assertEq(address(vault).balance, PRINCIPAL);
    }

    // -------------------------------------------------------------------------
    // Unauthorized approveCompletion — section 8 / section 13
    // -------------------------------------------------------------------------

    function test_approveCompletion_onlyAttestor() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);

        // Depositor cannot self-approve.
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotAttestor.selector, depositor));
        vault.approveCompletion(id, VERIF_HASH, 99);

        // Owner cannot approve either — admin has no attestation power.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotAttestor.selector, owner));
        vault.approveCompletion(id, VERIF_HASH, 99);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotAttestor.selector, stranger));
        vault.approveCompletion(id, VERIF_HASH, 99);
    }

    function test_approveCompletion_belowThreshold_reverts() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);

        vm.prank(attestor);
        vm.expectRevert(
            abi.encodeWithSelector(CommitmentVault.ConfidenceBelowThreshold.selector, THRESHOLD - 1, THRESHOLD)
        );
        vault.approveCompletion(id, VERIF_HASH, THRESHOLD - 1);
    }

    function test_approveCompletion_requiresCompletionRequestedState() public {
        (, uint256 id) = _activeCommitment(0, 0);
        // Skipped requestCompletion — still Active.
        vm.prank(attestor);
        vm.expectRevert(
            abi.encodeWithSelector(CommitmentVault.InvalidStatus.selector, CommitmentVault.CommitmentStatus.Active)
        );
        vault.approveCompletion(id, VERIF_HASH, 90);
    }

    // -------------------------------------------------------------------------
    // Double-claim / double-release — section 8 / section 13
    // -------------------------------------------------------------------------

    function test_doubleRelease_reverts() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 90);

        vm.prank(depositor);
        vault.releasePrincipal(id);

        // Status is Approved→Closed only after reward drained; here reward outstanding,
        // so it stays Approved, but principalWithdrawn guards the second call.
        vm.prank(depositor);
        vm.expectRevert(CommitmentVault.AlreadyWithdrawn.selector);
        vault.releasePrincipal(id);
    }

    function test_doubleClaim_reverts() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 90);

        vm.prank(depositor);
        vault.claimReward(id);
        vm.prank(depositor);
        vm.expectRevert(CommitmentVault.AlreadyWithdrawn.selector);
        vault.claimReward(id);
    }

    function test_cannotReleaseAfterCancel() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.cancelCommitment(id);

        vm.prank(depositor);
        vm.expectRevert(
            abi.encodeWithSelector(
                CommitmentVault.InvalidStatus.selector, CommitmentVault.CommitmentStatus.Cancelled
            )
        );
        vault.releasePrincipal(id);
    }

    // -------------------------------------------------------------------------
    // Wrong-caller withdrawal — section 8 / section 13
    // -------------------------------------------------------------------------

    function test_releasePrincipal_onlyDepositor() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 90);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotDepositor.selector, stranger));
        vault.releasePrincipal(id);

        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotDepositor.selector, attestor));
        vault.releasePrincipal(id);
    }

    function test_claimReward_onlyDepositor() public {
        (, uint256 id) = _activeCommitment(0, 0);
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 90);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotDepositor.selector, stranger));
        vault.claimReward(id);
    }

    // -------------------------------------------------------------------------
    // Changed conditions post-signature (section 13) — impossible by construction
    // -------------------------------------------------------------------------

    function test_noSetterForRewardOrThreshold() public {
        // There is deliberately no function to change rewardAmount or confidenceThreshold
        // after creation. This test documents that by asserting the terms are stable
        // across the whole lifecycle.
        (, uint256 id) = _activeCommitment(0, 0);
        CommitmentVault.Commitment memory c0 = vault.getCommitment(id);

        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vault.approveCompletion(id, VERIF_HASH, 90);

        CommitmentVault.Commitment memory c1 = vault.getCommitment(id);
        assertEq(c1.rewardAmount, c0.rewardAmount);
        assertEq(c1.confidenceThreshold, c0.confidenceThreshold);
        assertEq(c1.principalAmount, c0.principalAmount);
        assertEq(c1.depositor, c0.depositor);
    }

    function test_owner_cannotMoveFunds_onlyRotateAttestor() public {
        (, uint256 id) = _activeCommitment(0, 0);

        // Owner's entire power: rotate the attestor. It moves nothing.
        address newAttestor = makeAddr("newAttestor");
        vm.prank(owner);
        vault.setAttestor(newAttestor);
        assertEq(vault.attestor(), newAttestor);
        assertEq(address(vault).balance, PRINCIPAL + REWARD);

        // Non-owner cannot rotate.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.setAttestor(stranger);

        // The rotated-in attestor can now approve; the old one cannot.
        vm.prank(depositor);
        vault.requestCompletion(id, VERIF_HASH);
        vm.prank(attestor);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotAttestor.selector, attestor));
        vault.approveCompletion(id, VERIF_HASH, 90);
        vm.prank(newAttestor);
        vault.approveCompletion(id, VERIF_HASH, 90);
    }

    // -------------------------------------------------------------------------
    // Deposit / funding validation
    // -------------------------------------------------------------------------

    function test_lockFunds_wrongAmount_reverts() public {
        (, uint256 id) = _createCommitment(0, 0);
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.IncorrectValue.selector, PRINCIPAL, PRINCIPAL - 1));
        vault.lockFunds{value: PRINCIPAL - 1}(id);
    }

    function test_lockFunds_onlyDepositor() public {
        (, uint256 id) = _createCommitment(0, 0);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotDepositor.selector, stranger));
        vault.lockFunds{value: PRINCIPAL}(id);
    }

    function test_fundReward_wrongAmount_reverts() public {
        (, uint256 id) = _createCommitment(0, 0);
        vm.prank(sponsor);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.IncorrectValue.selector, REWARD, REWARD + 1));
        vault.fundReward{value: REWARD + 1}(id);
    }

    function test_fundReward_cannotDoubleFund() public {
        (, uint256 id) = _createCommitment(0, 0);
        vm.prank(sponsor);
        vault.fundReward{value: REWARD}(id);
        vm.prank(stranger);
        vm.expectRevert(CommitmentVault.RewardAlreadyFunded.selector);
        vault.fundReward{value: REWARD}(id);
    }

    function test_createCommitment_zeroPrincipal_reverts() public {
        vm.startPrank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        vm.expectRevert(CommitmentVault.ZeroPrincipal.selector);
        vault.createCommitment(goalId, 0, REWARD, 0, 0, THRESHOLD);
        vm.stopPrank();
    }

    function test_createCommitment_badThreshold_reverts() public {
        vm.startPrank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.InvalidConfidenceThreshold.selector, uint16(0)));
        vault.createCommitment(goalId, PRINCIPAL, REWARD, 0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.InvalidConfidenceThreshold.selector, uint16(101)));
        vault.createCommitment(goalId, PRINCIPAL, REWARD, 0, 0, 101);
        vm.stopPrank();
    }

    function test_createCommitment_pastDeadline_reverts() public {
        vm.warp(1_000_000);
        vm.startPrank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        uint64 past = uint64(block.timestamp - 1);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.DeadlineInPast.selector, past, uint64(block.timestamp)));
        vault.createCommitment(goalId, PRINCIPAL, REWARD, past, 0, THRESHOLD);
        vm.stopPrank();
    }

    function test_createCommitment_graceTooLong_reverts() public {
        vm.startPrank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        uint64 tooLong = vault.MAX_GRACE_PERIOD() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(CommitmentVault.GracePeriodTooLong.selector, tooLong, vault.MAX_GRACE_PERIOD())
        );
        vault.createCommitment(goalId, PRINCIPAL, REWARD, uint64(block.timestamp + 1 days), tooLong, THRESHOLD);
        vm.stopPrank();
    }

    function test_createCommitment_onlyGoalOwner() public {
        vm.prank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotGoalOwner.selector, stranger));
        vault.createCommitment(goalId, PRINCIPAL, REWARD, 0, 0, THRESHOLD);
    }

    function test_createCommitment_oneCommitmentPerGoal() public {
        (uint256 goalId,) = _createCommitment(0, 0);
        vm.prank(depositor);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.GoalAlreadyCommitted.selector, goalId));
        vault.createCommitment(goalId, PRINCIPAL, REWARD, 0, 0, THRESHOLD);
    }

    // -------------------------------------------------------------------------
    // TransferFailed — a rejecting recipient cannot corrupt state or strand others
    // -------------------------------------------------------------------------

    function test_cancel_toRejectingReceiver_revertsWholeCall() public {
        RejectingReceiver rr = new RejectingReceiver(vault);
        vm.deal(address(rr), PRINCIPAL);
        vm.prank(address(rr));
        uint256 goalId = rr.registerGoal(GOAL_HASH);
        vm.prank(address(rr));
        uint256 id = rr.createCommitment(goalId, PRINCIPAL, 0, 0, 0, THRESHOLD);
        vm.prank(address(rr));
        rr.lockFunds{value: PRINCIPAL}(id);

        // Refund transfer fails → the whole cancel reverts atomically; funds stay put
        // and status is unchanged (still Active), so it can be retried later.
        vm.prank(address(rr));
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.TransferFailed.selector, address(rr), PRINCIPAL));
        rr.cancel(id);
        assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Active));
        assertEq(address(vault).balance, PRINCIPAL);
    }

    // -------------------------------------------------------------------------
    // Accountability-only anchoring (Mode A)
    // -------------------------------------------------------------------------

    function test_registerGoal_and_milestones() public {
        vm.prank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        assertEq(vault.getGoal(goalId).owner, depositor);

        bytes32 mRef = keccak256("milestone-1");
        bytes32 mHash = keccak256("m1-verification");
        // Attestor records a verified milestone.
        vm.prank(attestor);
        vault.registerMilestone(goalId, mRef, mHash, 88);
        // Goal owner records their own.
        vm.prank(depositor);
        vault.registerMilestone(goalId, keccak256("milestone-2"), keccak256("m2"), 70);

        assertEq(vault.milestoneCount(goalId), 2);
        assertEq(vault.getMilestones(goalId)[0].verificationHash, mHash);

        uint256[] memory goals = vault.getWalletGoals(depositor);
        assertEq(goals.length, 1);
        assertEq(goals[0], goalId);
    }

    function test_registerMilestone_strangerRejected() public {
        vm.prank(depositor);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.NotAttestor.selector, stranger));
        vault.registerMilestone(goalId, keccak256("m"), keccak256("h"), 50);
    }

    function test_registerGoal_emptyHashRejected() public {
        vm.prank(depositor);
        vm.expectRevert(CommitmentVault.EmptyVerificationHash.selector);
        vault.registerGoal(bytes32(0));
    }

    // -------------------------------------------------------------------------
    // View reverts on unknown ids
    // -------------------------------------------------------------------------

    function test_getCommitment_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.UnknownCommitment.selector, uint256(999)));
        vault.getCommitment(999);
    }

    function test_getGoal_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CommitmentVault.UnknownGoal.selector, uint256(999)));
        vault.getGoal(999);
    }

    function test_cancellationOpensAt_reportsBoundary() public {
        uint64 deadline = uint64(block.timestamp + 10 days);
        (, uint256 id) = _activeCommitment(deadline, 3 days);
        assertEq(vault.cancellationOpensAt(id), deadline + 3 days);
    }

    // -------------------------------------------------------------------------
    // Fuzz — principal/reward round-trips exactly, no dust left behind
    // -------------------------------------------------------------------------

    function testFuzz_cancel_returnsExactly(uint96 principal, uint96 reward) public {
        principal = uint96(bound(principal, 1, 1_000 ether));
        reward = uint96(bound(reward, 0, 1_000 ether));

        address d = makeAddr("fuzzDep");
        address s = makeAddr("fuzzSpon");
        vm.deal(d, uint256(principal));
        vm.deal(s, uint256(reward));

        vm.startPrank(d);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        uint256 id = vault.createCommitment(goalId, principal, reward, 0, 0, THRESHOLD);
        vm.stopPrank();

        if (reward > 0) {
            vm.prank(s);
            vault.fundReward{value: reward}(id);
        }
        vm.prank(d);
        vault.lockFunds{value: principal}(id);

        vm.prank(d);
        vault.cancelCommitment(id);

        assertEq(d.balance, uint256(principal));
        assertEq(s.balance, uint256(reward));
        assertEq(address(vault).balance, 0);
    }

    function testFuzz_approveThreshold(uint16 threshold, uint16 confidence) public {
        threshold = uint16(bound(threshold, 1, 100));
        address d = makeAddr("fuzzDep2");
        vm.deal(d, PRINCIPAL);
        vm.startPrank(d);
        uint256 goalId = vault.registerGoal(GOAL_HASH);
        uint256 id = vault.createCommitment(goalId, PRINCIPAL, 0, 0, 0, threshold);
        vault.lockFunds{value: PRINCIPAL}(id);
        vault.requestCompletion(id, VERIF_HASH);
        vm.stopPrank();

        vm.prank(attestor);
        if (confidence < threshold) {
            vm.expectRevert(
                abi.encodeWithSelector(CommitmentVault.ConfidenceBelowThreshold.selector, confidence, threshold)
            );
            vault.approveCompletion(id, VERIF_HASH, confidence);
        } else {
            vault.approveCompletion(id, VERIF_HASH, confidence);
            assertEq(uint8(vault.getCommitmentStatus(id)), uint8(CommitmentVault.CommitmentStatus.Approved));
        }
    }
}
