// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommitmentVault} from "../src/CommitmentVault.sol";

/// @notice Malicious depositor that tries to re-enter a withdrawal to drain more than
///         its share. Used to prove the `nonReentrant` guard + effects-before-interaction
///         ordering hold. It re-enters whichever withdrawal is currently under test.
contract ReentrantAttacker {
    CommitmentVault public immutable vault;
    uint256 public commitmentId;
    uint256 public reentryCount;
    bool public reentering;

    enum Target {
        None,
        ReleasePrincipal,
        ClaimReward,
        Cancel
    }

    Target public target;

    constructor(CommitmentVault _vault) {
        vault = _vault;
    }

    function setTarget(uint256 _commitmentId, Target _target) external {
        commitmentId = _commitmentId;
        target = _target;
    }

    // Attacker is the depositor, so it drives the whole lifecycle itself.
    function registerGoal(bytes32 h) external returns (uint256) {
        return vault.registerGoal(h);
    }

    function createCommitment(
        uint256 goalId,
        uint256 principal,
        uint256 reward,
        uint64 deadline,
        uint64 grace,
        uint16 threshold
    ) external returns (uint256) {
        return vault.createCommitment(goalId, principal, reward, deadline, grace, threshold);
    }

    function lockFunds(uint256 id) external payable {
        vault.lockFunds{value: msg.value}(id);
    }

    function requestCompletion(uint256 id, bytes32 h) external {
        vault.requestCompletion(id, h);
    }

    function releasePrincipal(uint256 id) external {
        vault.releasePrincipal(id);
    }

    function claimReward(uint256 id) external {
        vault.claimReward(id);
    }

    function cancel(uint256 id) external {
        vault.cancelCommitment(id);
    }

    receive() external payable {
        // On the first inbound transfer, try to re-enter the same withdrawal.
        if (reentering) return;
        reentering = true;
        reentryCount++;
        if (target == Target.ReleasePrincipal) {
            vault.releasePrincipal(commitmentId);
        } else if (target == Target.ClaimReward) {
            vault.claimReward(commitmentId);
        } else if (target == Target.Cancel) {
            vault.cancelCommitment(commitmentId);
        }
        reentering = false;
    }
}

/// @notice A recipient that rejects ETH, to exercise the `TransferFailed` path without
///         leaving funds stuck in an inconsistent state.
contract RejectingReceiver {
    CommitmentVault public immutable vault;

    constructor(CommitmentVault _vault) {
        vault = _vault;
    }

    function registerGoal(bytes32 h) external returns (uint256) {
        return vault.registerGoal(h);
    }

    function createCommitment(
        uint256 goalId,
        uint256 principal,
        uint256 reward,
        uint64 deadline,
        uint64 grace,
        uint16 threshold
    ) external returns (uint256) {
        return vault.createCommitment(goalId, principal, reward, deadline, grace, threshold);
    }

    function lockFunds(uint256 id) external payable {
        vault.lockFunds{value: msg.value}(id);
    }

    function cancel(uint256 id) external {
        vault.cancelCommitment(id);
    }

    receive() external payable {
        revert("no ETH");
    }
}
