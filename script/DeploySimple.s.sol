// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

contract DeploySimple is Script {
    // With a fresh Anvil instance and deploying as the first transaction,
    // the registry will always be at 0x5FbDB2315678afecb367f032d93F642f64180aa3
    address constant EXPECTED_REGISTRY = 0x5FbDB2315678afecb367f032d93F642f64180aa3;
    
    function run() public {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        vm.startBroadcast(deployerPrivateKey);
        
        // Check if already deployed
        if (EXPECTED_REGISTRY.code.length > 0) {
            console.log("QIPRegistry already deployed at:", EXPECTED_REGISTRY);
        } else {
            // Deploy QIPRegistry as the first contract
            QIPRegistry registry = new QIPRegistry();
            console.log("QIPRegistry deployed at:", address(registry));
            
            // Log the actual address
            console.log("WARNING: Registry deployed at different address than expected");
            console.log("Expected:", EXPECTED_REGISTRY);
            console.log("Actual:", address(registry));
        }
        
        vm.stopBroadcast();
    }
}