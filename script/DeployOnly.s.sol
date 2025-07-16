// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

contract DeployOnly is Script {
    function run() public {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        vm.startBroadcast(deployerPrivateKey);
        
        // Deploy QIPRegistry
        QIPRegistry registry = new QIPRegistry();
        console.log("QIPRegistry deployed at:", address(registry));
        
        vm.stopBroadcast();
    }
}