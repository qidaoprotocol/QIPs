// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

contract LocalQIPTest is Script {
    QIPRegistry public registry;
    
    // Test accounts from Anvil's default mnemonic
    address constant GOVERNANCE = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant EDITOR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant AUTHOR1 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant AUTHOR2 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address constant AUTHOR3 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    
    function run() public {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        
        // Get registry address from environment variable
        address registryAddress = vm.envAddress("QIP_REGISTRY_ADDRESS");
        registry = QIPRegistry(registryAddress);
        console.log("Using QIPRegistry at:", address(registry));
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Setup roles (governance account should already have permissions)
        registry.setEditor(EDITOR, true);
        console.log("Editor role granted to:", EDITOR);
        
        vm.stopBroadcast();
        
        // Create test QIPs as different authors
        _createTestQIPs();
        
        // Don't create fake historical QIPs - we have real ones from migration
        // _migrateHistoricalQIPs();
        
        // Simulate QIP lifecycle
        _simulateQIPLifecycle();
        
        console.log("\n=== Local QIP Test Setup Complete ===");
        console.log("Registry Address:", address(registry));
        console.log("Governance:", GOVERNANCE);
        console.log("Editor:", EDITOR);
        console.log("Test Authors:", AUTHOR1, AUTHOR2, AUTHOR3);
        console.log("\nNext QIP Number:", registry.nextQIPNumber());
    }
    
    function _createTestQIPs() internal {
        // Check if we need to create test QIPs or if they already exist
        uint256 currentNextQIP = registry.nextQIPNumber();
        
        // With the new setup, we start at 209, so test QIPs would be created at 209, 210, 211
        // But we want to preserve 209-248 for migration, so let's create test QIPs at 249+
        if (currentNextQIP > 252) {
            console.log("Test QIPs already exist, skipping creation");
            console.log("Current nextQIPNumber:", currentNextQIP);
            return;
        }
        
        // If we're starting fresh at 209, we need to skip to 249 for test QIPs
        if (currentNextQIP < 249) {
            console.log("Registry starts at", currentNextQIP, "- will create test QIPs at 249+");
            // We'll use migrateQIP to create them at specific numbers
            return;
        }
        
        // Use governance account to migrate test QIPs at specific numbers
        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        
        // Check if QIP-249 already exists
        try registry.qips(249) returns (uint256 qipNum, address, string memory, string memory, bytes32, string memory, uint256, uint256, QIPRegistry.QIPStatus, string memory, uint256, string memory, uint256) {
            if (qipNum == 249) {
                console.log("QIP-249 already exists, skipping test QIP creation");
                vm.stopBroadcast();
                return;
            }
        } catch {
            // QIP doesn't exist, continue with creation
        }
        
        // Migrate test QIPs at specific numbers with real IPFS content
        registry.migrateQIP(
            249,
            AUTHOR1,
            "Implement Dynamic Interest Rates",
            "Polygon",
            keccak256("QIP-249: Dynamic Interest Rate Model Implementation"),
            "ipfs://QmWYqKxQPcsAkTLvkGZmZP9oWAEeCYP8J7X5XvKeEHEeC1",
            block.timestamp,
            QIPRegistry.QIPStatus.Draft,
            "None",
            0,
            ""
        );
        console.log("Created QIP-249 (Draft) by AUTHOR1");
        
        registry.migrateQIP(
            250,
            AUTHOR2,
            "Add Support for New Collateral Types",
            "Base",
            keccak256("QIP-250: Multi-Collateral Support"),
            "ipfs://QmXRwXY9QBdAnu3r6hWCaCYKv2Xn5jtB8ZzyS53dQzHDuo",
            block.timestamp,
            QIPRegistry.QIPStatus.Draft,
            "None",
            0,
            ""
        );
        console.log("Created QIP-250 (Draft) by AUTHOR2");
        
        registry.migrateQIP(
            251,
            AUTHOR3,
            "Governance Token Staking Rewards",
            "Ethereum",
            keccak256("QIP-251: Staking Rewards Program"),
            "ipfs://QmUJcCwZBKtgF5PjbwSEBVT9royDfpwtt6FRE36N42km1M",
            block.timestamp,
            QIPRegistry.QIPStatus.Draft,
            "None",
            0,
            ""
        );
        console.log("Created QIP-251 (Draft) by AUTHOR3");
        
        vm.stopBroadcast();
    }
    
    // Removed _migrateHistoricalQIPs - we use real QIPs from migration instead
    
    function _simulateQIPLifecycle() internal {
        // Check if test QIP-249 exists before trying to simulate lifecycle
        try registry.qips(249) returns (uint256 qipNum, address, string memory, string memory, bytes32, string memory, uint256, uint256, QIPRegistry.QIPStatus, string memory, uint256, string memory, uint256) {
            if (qipNum != 249) {
                console.log("QIP-249 does not exist, skipping lifecycle simulation");
                return;
            }
        } catch {
            console.log("QIP-249 does not exist, skipping lifecycle simulation");
            return;
        }
        
        // Only simulate lifecycle if QIP-249 exists and is in Draft status
        (, , , , , , , , QIPRegistry.QIPStatus status249, , , ,) = registry.qips(249);
        if (status249 != QIPRegistry.QIPStatus.Draft) {
            console.log("QIP-249 is not in Draft status, skipping lifecycle simulation");
            return;
        }
        
        // Move QIP-249 through lifecycle (use governance account for editor operations)
        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        
        // Update status to ReviewPending
        registry.updateStatus(249, QIPRegistry.QIPStatus.ReviewPending);
        console.log("\nQIP-249: Draft -> ReviewPending");
        
        vm.stopBroadcast();
        
        // Author updates the QIP content
        vm.startBroadcast(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);
        
        registry.updateQIP(
            249,
            "Implement Dynamic Interest Rates (Revised)",
            keccak256("QIP-249: Dynamic Interest Rate Model Implementation v2"),
            "ipfs://QmWYqKxQPcsAkTLvkGZmZP9oWAEeCYP8J7X5XvKeEHEeC1", // Using same CID for simplicity
            "Added more detailed implementation specs"
        );
        console.log("QIP-249: Updated to version 2");
        
        // Link to Snapshot
        registry.linkSnapshotProposal(249, "snapshot.org/#/qidao.eth/proposal/0x249test");
        console.log("QIP-249: Linked to Snapshot (auto-status: VotePending)");
        
        vm.stopBroadcast();
        
        // Editor approves after vote passes (use governance account for editor operations)
        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        
        registry.updateStatus(249, QIPRegistry.QIPStatus.Approved);
        console.log("QIP-249: VotePending -> Approved");
        
        // Set implementation details
        registry.setImplementation(249, "Core Team", block.timestamp + 7 days);
        console.log("QIP-249: Implementation scheduled");
        
        // Mark as implemented
        registry.updateStatus(249, QIPRegistry.QIPStatus.Implemented);
        console.log("QIP-249: Approved -> Implemented");
        
        // Move QIP-250 to voting
        registry.updateStatus(250, QIPRegistry.QIPStatus.ReviewPending);
        console.log("\nQIP-250: Draft -> ReviewPending");
        
        // Update status for QIP-251 to withdrawn
        registry.updateStatus(251, QIPRegistry.QIPStatus.Withdrawn);
        console.log("\nQIP-251: Draft -> Withdrawn");
        
        vm.stopBroadcast();
        
        // Disable migration mode
        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        registry.disableMigrationMode();
        console.log("\nMigration mode disabled");
        vm.stopBroadcast();
    }
}