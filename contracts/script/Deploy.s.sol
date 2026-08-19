// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CommitmentVault} from "../src/CommitmentVault.sol";

/// @title Deploy CommitmentVault to BOT Chain testnet
/// @notice Run with:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url botchain_testnet --broadcast -vvvv
///
/// Requires these env vars (see `.env.example`):
///   PRIVATE_KEY               deployer key, funded with tBOT from the faucet
///   INITIAL_OWNER  (optional) admin that can rotate the attestor; SHOULD be a
///                             distinct account (ideally a multisig) — see DEPLOY.md
///   INITIAL_ATTESTOR          the backend attestor address (proposes verification)
///   ALLOW_COLLAPSED_ROLES     (optional, default false) opt-in to reuse ONE account
///                             across roles — throwaway local/testnet spikes only
///
/// The deployer needs tBOT: BOT Chain testnet faucet gives 10 tBOT / 24h.
/// RPC + chain id are read from foundry.toml's [rpc_endpoints] / the --rpc-url flag,
/// NOT hardcoded here — values live in `.env.example`, sourced from official docs.
///
/// SEPARATION OF DUTIES (LIMITATIONS.md item 4): by default this script REFUSES a
/// deploy that reuses one account as deployer, owner, AND attestor. None of the three
/// can move a depositor's funds (the contract makes every transfer depositor-signed and
/// pull-based), so collapsing them is not a fund-safety hole — but it removes
/// defence-in-depth, so distinct accounts are the enforced default. See `DEPLOY.md` for
/// the recommended distinct-EOA + Safe-multisig-owner setup and the rotation procedure.
contract Deploy is Script {
    function run() external returns (CommitmentVault vault) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Owner defaults to the deployer; attestor MUST be set explicitly so a deploy
        // can't silently make the deployer the money-approving attestor by accident.
        address initialOwner = vm.envOr("INITIAL_OWNER", deployer);
        address initialAttestor = vm.envAddress("INITIAL_ATTESTOR");
        bool allowCollapsedRoles = vm.envOr("ALLOW_COLLAPSED_ROLES", false);

        // Opsec policy gate (pure, unit-tested in test/Deploy.t.sol) — reverts before
        // any broadcast if the roles are collapsed without an explicit opt-in.
        validateRoles(deployer, initialOwner, initialAttestor, allowCollapsedRoles);

        console2.log("Chain id:       ", block.chainid);
        console2.log("Deployer:       ", deployer);
        console2.log("Initial owner:  ", initialOwner);
        console2.log("Initial attestor:", initialAttestor);
        if (allowCollapsedRoles) {
            console2.log(
                "WARNING: ALLOW_COLLAPSED_ROLES=true - roles may be collapsed (throwaway use only)"
            );
        }

        vm.startBroadcast(deployerKey);
        vault = new CommitmentVault(initialOwner, initialAttestor);
        vm.stopBroadcast();

        console2.log("CommitmentVault deployed at:", address(vault));
        return vault;
    }

    /// @notice Separation-of-duties policy for a production deploy (LIMITATIONS item 4).
    /// @dev Pure so it is unit-testable without a broadcast. Unless `allowCollapsedRoles`
    ///      is set, requires the deployer, owner, and attestor to be three distinct
    ///      accounts. This is defence-in-depth, not a money-safety invariant: the
    ///      contract already guarantees no role can move a depositor's funds. The
    ///      money-relevant separation is attestor-vs-the-rest (a stolen attestor key must
    ///      not also be the admin that could name a new attestor); owner-vs-deployer keeps
    ///      the long-lived admin (ideally a multisig) off the throwaway deploy key.
    function validateRoles(
        address deployer,
        address owner,
        address attestor,
        bool allowCollapsedRoles
    ) public pure {
        if (allowCollapsedRoles) return;
        require(
            attestor != deployer,
            "Deploy: attestor must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)"
        );
        require(
            attestor != owner,
            "Deploy: attestor must differ from owner (or set ALLOW_COLLAPSED_ROLES=true)"
        );
        require(
            owner != deployer,
            "Deploy: owner must differ from deployer (or set ALLOW_COLLAPSED_ROLES=true)"
        );
    }
}
