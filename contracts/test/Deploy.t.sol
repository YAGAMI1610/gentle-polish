// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @title Deploy script role-separation policy tests (LIMITATIONS item 4)
/// @notice The deploy script refuses to collapse deployer/owner/attestor into one
///         account unless explicitly overridden. These prove that policy directly
///         against the pure `validateRoles` gate — no broadcast, no funded key needed.
contract DeployTest is Test {
    Deploy internal deploy;

    address internal constant DEPLOYER = address(0xD1);
    address internal constant OWNER = address(0x0E);
    address internal constant ATTESTOR = address(0xA7);

    function setUp() public {
        deploy = new Deploy();
    }

    function test_validateRoles_passesWhenAllThreeDistinct() public view {
        // Three distinct accounts is the intended production shape — no revert.
        deploy.validateRoles(DEPLOYER, OWNER, ATTESTOR, false);
    }

    function test_validateRoles_revertsWhenAttestorEqualsDeployer() public {
        vm.expectRevert(
            bytes("Deploy: attestor must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, OWNER, DEPLOYER, false);
    }

    function test_validateRoles_revertsWhenAttestorEqualsOwner() public {
        vm.expectRevert(
            bytes("Deploy: attestor must differ from owner (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, OWNER, OWNER, false);
    }

    function test_validateRoles_revertsWhenOwnerEqualsDeployer() public {
        // Owner defaults to the deployer when INITIAL_OWNER is unset — this is exactly
        // the collapse the gate is meant to catch (attestor here is distinct).
        vm.expectRevert(
            bytes("Deploy: owner must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, DEPLOYER, ATTESTOR, false);
    }

    function test_validateRoles_overrideAllowsCollapsedRoles() public view {
        // The explicit opt-in (throwaway local/testnet spikes) bypasses every check,
        // even all three being the same account.
        deploy.validateRoles(DEPLOYER, DEPLOYER, DEPLOYER, true);
    }

    function test_validateRoles_revertsWhenAllThreeCollapsedWithoutOverride() public {
        // With no override, the first failing check (attestor == deployer) fires.
        vm.expectRevert(
            bytes("Deploy: attestor must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, DEPLOYER, DEPLOYER, false);
    }
}
