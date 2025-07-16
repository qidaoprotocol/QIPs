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
        
        // Migrate historical QIPs
        _migrateHistoricalQIPs();
        
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
        
        if (currentNextQIP > 249) {
            console.log("Test QIPs already exist, skipping creation");
            console.log("Current nextQIPNumber:", currentNextQIP);
            return;
        }
        
        // Create QIP as AUTHOR1
        vm.startBroadcast(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);
        
        uint256 qip1 = registry.createQIP(
            "Implement Dynamic Interest Rates",
            "Polygon",
            keccak256("QIP-249: Dynamic Interest Rate Model Implementation"),
            "ipfs://QmTest249DynamicRates"
        );
        console.log("Created QIP-249 (Draft) by AUTHOR1");
        
        vm.stopBroadcast();
        
        // Create QIP as AUTHOR2
        vm.startBroadcast(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a);
        
        uint256 qip2 = registry.createQIP(
            "Add Support for New Collateral Types",
            "Base",
            keccak256("QIP-250: Multi-Collateral Support"),
            "ipfs://QmTest250MultiCollateral"
        );
        console.log("Created QIP-250 (Draft) by AUTHOR2");
        
        vm.stopBroadcast();
        
        // Create QIP as AUTHOR3
        vm.startBroadcast(0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6);
        
        uint256 qip3 = registry.createQIP(
            "Governance Token Staking Rewards",
            "Ethereum",
            keccak256("QIP-251: Staking Rewards Program"),
            "ipfs://QmTest251StakingRewards"
        );
        console.log("Created QIP-251 (Draft) by AUTHOR3");
        
        vm.stopBroadcast();
    }
    
    function _migrateHistoricalQIPs() internal {
        // Use governance account (which has migration permissions)
        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        
        // Migrate some historical QIPs with different statuses
        registry.migrateQIP(
            100,
            0x1234567890123456789012345678901234567890,
            "Historical: Protocol Launch",
            "Polygon",
            keccak256("QIP-100: Protocol Launch"),
            "ipfs://QmHistorical100",
            1640995200, // Jan 1, 2022
            QIPRegistry.QIPStatus.Implemented,
            "Core Team",
            1641600000, // Jan 8, 2022
            "snapshot.org/#/qidao.eth/proposal/0x100"
        );
        console.log("Migrated QIP-100 (Implemented)");
        
        registry.migrateQIP(
            150,
            0x2345678901234567890123456789012345678901,
            "Historical: Rejected Proposal",
            "Ethereum",
            keccak256("QIP-150: Rejected Proposal"),
            "ipfs://QmHistorical150",
            1651017600, // Apr 27, 2022
            QIPRegistry.QIPStatus.Rejected,
            "None",
            0,
            "snapshot.org/#/qidao.eth/proposal/0x150"
        );
        console.log("Migrated QIP-150 (Rejected)");
        
        registry.migrateQIP(
            200,
            0x3456789012345678901234567890123456789012,
            "Historical: Superseded Protocol Update",
            "Base",
            keccak256("QIP-200: Old Protocol Update"),
            "ipfs://QmHistorical200",
            1667260800, // Nov 1, 2022
            QIPRegistry.QIPStatus.Superseded,
            "Core Team",
            1668470400, // Nov 15, 2022
            "snapshot.org/#/qidao.eth/proposal/0x200"
        );
        console.log("Migrated QIP-200 (Superseded)");
        
        vm.stopBroadcast();
    }
    
    function _simulateQIPLifecycle() internal {
        // Check if test QIPs exist before trying to simulate lifecycle
        uint256 currentNextQIP = registry.nextQIPNumber();
        if (currentNextQIP <= 249) {
            console.log("No test QIPs to simulate lifecycle for");
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
            "ipfs://QmTest249DynamicRatesV2",
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