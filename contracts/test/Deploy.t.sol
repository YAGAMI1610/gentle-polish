// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @title Deploy script role-separation policy tests (LIMITATIONS items 4 and 11)
/// @notice The deploy script refuses to collapse deployer/owner/attestor/aiVerifier into
///         one account unless explicitly overridden — and refuses attestor == aiVerifier
///         even WITH the override, because that one is a contract invariant (I7) rather
///         than an opsec preference. These prove that policy directly against the pure
///         `validateRoles` gate — no broadcast, no funded key needed.
contract DeployTest is Test {
    Deploy internal deploy;

    address internal constant DEPLOYER = address(0xD1);
    address internal constant OWNER = address(0x0E);
    address internal constant ATTESTOR = address(0xA7);
    address internal constant VERIFIER = address(0xF1);

    function setUp() public {
        deploy = new Deploy();
    }

    function test_validateRoles_passesWhenAllFourDistinct() public view {
        // Four distinct accounts is the intended production shape — no revert.
        deploy.validateRoles(DEPLOYER, OWNER, ATTESTOR, VERIFIER, false);
    }

    function test_validateRoles_revertsWhenAttestorEqualsDeployer() public {
        vm.expectRevert(
            bytes("Deploy: attestor must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, OWNER, DEPLOYER, VERIFIER, false);
    }

    function test_validateRoles_revertsWhenAttestorEqualsOwner() public {
        vm.expectRevert(
            bytes("Deploy: attestor must differ from owner (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, OWNER, OWNER, VERIFIER, false);
    }

    function test_validateRoles_revertsWhenOwnerEqualsDeployer() public {
        // Owner defaults to the deployer when INITIAL_OWNER is unset — this is exactly
        // the collapse the gate is meant to catch (attestor here is distinct).
        vm.expectRevert(
            bytes("Deploy: owner must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, DEPLOYER, ATTESTOR, VERIFIER, false);
    }

    function test_validateRoles_revertsWhenVerifierEqualsDeployer() public {
        vm.expectRevert(
            bytes(
                "Deploy: aiVerifier must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)"
            )
        );
        deploy.validateRoles(DEPLOYER, OWNER, ATTESTOR, DEPLOYER, false);
    }

    function test_validateRoles_revertsWhenVerifierEqualsOwner() public {
        vm.expectRevert(
            bytes("Deploy: aiVerifier must differ from owner (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, OWNER, ATTESTOR, OWNER, false);
    }

    function test_validateRoles_overrideAllowsCollapsedRoles() public view {
        // The explicit opt-in (throwaway local/testnet spikes) bypasses every OPSEC check,
        // even deployer == owner == attestor.
        deploy.validateRoles(DEPLOYER, DEPLOYER, DEPLOYER, VERIFIER, true);
    }

    function test_validateRoles_revertsWhenAllCollapsedWithoutOverride() public {
        // With no override, the first failing opsec check (attestor == deployer) fires.
        vm.expectRevert(
            bytes("Deploy: attestor must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)")
        );
        deploy.validateRoles(DEPLOYER, DEPLOYER, DEPLOYER, VERIFIER, false);
    }

    // -------------------------------------------------------------------------
    // attestor != aiVerifier — contract invariant I7, NOT waivable
    // -------------------------------------------------------------------------

    function test_validateRoles_revertsWhenVerifierEqualsAttestor() public {
        vm.expectRevert(
            bytes(
                "Deploy: attestor must differ from aiVerifier (contract invariant I7, not waivable)"
            )
        );
        deploy.validateRoles(DEPLOYER, OWNER, ATTESTOR, ATTESTOR, false);
    }

    function test_validateRoles_overrideCannotWaiveAttestorVsVerifier() public {
        // ALLOW_COLLAPSED_ROLES is an opsec escape hatch; it cannot buy back a collapsed
        // two-of-two approval. The contract's constructor would revert on this too.
        vm.expectRevert(
            bytes(
                "Deploy: attestor must differ from aiVerifier (contract invariant I7, not waivable)"
            )
        );
        deploy.validateRoles(DEPLOYER, OWNER, ATTESTOR, ATTESTOR, true);
    }
}
