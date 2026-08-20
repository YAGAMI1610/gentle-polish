// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Erc1271Verifier
/// @notice A real ERC-1271 signer, used to prove `CommitmentVault.aiVerifier` may be a
///         contract (multisig / threshold signer) and not only an EOA — the production
///         hardening path recorded in LIMITATIONS.md §19.1 fix 1, reachable with no
///         further contract change.
/// @dev Deliberately NOT a stub that returns the magic value unconditionally: it recovers
///      the signer from the hash and compares it to the key it was constructed with, so a
///      signature from any other key is genuinely rejected and the vault's
///      `SignatureChecker` path is exercised end to end.
contract Erc1271Verifier {
    /// @dev ERC-1271 magic value: `bytes4(keccak256("isValidSignature(bytes32,bytes)"))`.
    bytes4 internal constant MAGIC_VALUE = 0x1626ba7e;

    address public immutable authorizedSigner;

    constructor(address authorizedSigner_) {
        authorizedSigner = authorizedSigner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != authorizedSigner) {
            return 0xffffffff;
        }
        return MAGIC_VALUE;
    }
}
