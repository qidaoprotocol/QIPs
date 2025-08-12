// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

/**
 * @title Deploy Local QIP Registry
 * @notice Simple deployment for local development
 */
contract DeployLocal is Script {
    function run() public returns (address) {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy QIPRegistry (initial admin set to msg.sender)
        QIPRegistry registry = new QIPRegistry(209, msg.sender);
        
        console.log("QIPRegistry deployed at:", address(registry));
        console.log("Admin set to:", msg.sender);
        
        vm.stopBroadcast();
        
        return address(registry);
    }
}