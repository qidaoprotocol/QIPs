// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../contracts/QIPRegistry.sol";
import "../contracts/QIPGovernance.sol";

contract Deploy is Script {
    function setUp() public {}

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying contracts with account:", deployer);
        console.log("Account balance:", deployer.balance);
        
        vm.startBroadcast(deployerPrivateKey);

        // Deploy QIPRegistry with starting QIP number
        // Start at 209 to allow migration of existing QIPs (209-248)
        QIPRegistry registry = new QIPRegistry(209, msg.sender);
        console.log("QIPRegistry deployed to:", address(registry));
        console.log("Starting QIP number:", registry.nextQIPNumber());

        // Deploy QIPGovernance
        QIPGovernance governance = new QIPGovernance(address(registry));
        console.log("QIPGovernance deployed to:", address(governance));

        // Transfer registry governance to the governance contract
        registry.transferGovernance(address(governance));
        console.log("Registry governance transferred to governance contract");

        // Grant initial editor roles (you can add addresses here)
        // governance.grantRole(0xYourAddress, QIPGovernance.Role.Editor, 0, "Initial editor");

        vm.stopBroadcast();

        // Log deployment info for frontend
        console.log("\n=== Deployment Complete ===");
        console.log("QIP_REGISTRY_ADDRESS=", address(registry));
        console.log("QIP_GOVERNANCE_ADDRESS=", address(governance));
        console.log("\nAdd these addresses to your .env file");
    }
}