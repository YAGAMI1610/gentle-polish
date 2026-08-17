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
///   INITIAL_OWNER  (optional) admin that can rotate the attestor; defaults to deployer
///   INITIAL_ATTESTOR          the backend attestor address (proposes verification)
///
/// The deployer needs tBOT: BOT Chain testnet faucet gives 10 tBOT / 24h.
/// RPC + chain id are read from foundry.toml's [rpc_endpoints] / the --rpc-url flag,
/// NOT hardcoded here — values live in `.env.example`, sourced from official docs.
contract Deploy is Script {
    function run() external returns (CommitmentVault vault) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Owner defaults to the deployer; attestor MUST be set explicitly so a deploy
        // can't silently make the deployer the money-approving attestor by accident.
        address initialOwner = vm.envOr("INITIAL_OWNER", deployer);
        address initialAttestor = vm.envAddress("INITIAL_ATTESTOR");

        console2.log("Chain id:       ", block.chainid);
        console2.log("Deployer:       ", deployer);
        console2.log("Initial owner:  ", initialOwner);
        console2.log("Initial attestor:", initialAttestor);

        vm.startBroadcast(deployerKey);
        vault = new CommitmentVault(initialOwner, initialAttestor);
        vm.stopBroadcast();

        console2.log("CommitmentVault deployed at:", address(vault));
        return vault;
    }
}
