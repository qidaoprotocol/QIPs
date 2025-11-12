// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {QCIRegistry} from "../contracts/QCIRegistry.sol";

/**
 * @title AddImplementedStatus
 * @notice Script to add "Implemented" status to the deployed QCIRegistry
 * @dev This uses the existing addStatus() function on the deployed contract
 *
 * Usage:
 *   forge script script/AddImplementedStatus.s.sol:AddImplementedStatus \
 *     --rpc-url $BASE_RPC_URL \
 *     --broadcast \
 *     --verify
 *
 * Or with keystore (recommended for production):
 *   forge script script/AddImplementedStatus.s.sol:AddImplementedStatus \
 *     --rpc-url $BASE_RPC_URL \
 *     --account <account-name> \
 *     --sender <sender-address> \
 *     --broadcast \
 *     --verify
 */
contract AddImplementedStatus is Script {
    // Production QCI Registry address on Base
    address constant REGISTRY_ADDRESS = 0xd476a2916b5BACfbB243F40CD59c4B6a7598BDF0;

    function run() public {
        // Get deployer from environment or keystore
        vm.startBroadcast();

        QCIRegistry registry = QCIRegistry(REGISTRY_ADDRESS);

        // Check if the caller has EDITOR_ROLE
        bytes32 editorRole = keccak256("EDITOR_ROLE");
        require(
            registry.hasRole(editorRole, msg.sender),
            "Caller must have EDITOR_ROLE to add status"
        );

        // Check if "Implemented" status already exists
        bool exists = registry.statusExists("Implemented");

        if (exists) {
            console.log("Status 'Implemented' already exists!");
            console.log("Status hash:", vm.toString(keccak256("Implemented")));
        } else {
            console.log("Adding 'Implemented' status to QCIRegistry at:", REGISTRY_ADDRESS);

            // Add the new status
            uint256 statusIndex = registry.addStatus("Implemented");

            // Calculate and log the hash
            bytes32 statusHash = keccak256("Implemented");

            console.log("");
            console.log("=== Status Added Successfully ===");
            console.log("Status Name: Implemented");
            console.log("Status Hash:", vm.toString(statusHash));
            console.log("Status Index:", statusIndex);
            console.log("");
            console.log("=== Add this to statusConfig.ts ===");
            console.log("Implemented = 4");
            console.log("hash:", vm.toString(statusHash));
            console.log("");
        }

        vm.stopBroadcast();
    }
}
