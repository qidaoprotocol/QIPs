// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

// Simple CREATE2 Factory for deterministic deployment
contract Create2Factory {
    event Deployed(address addr, bytes32 salt);

    function deploy(bytes memory bytecode, bytes32 salt) external returns (address) {
        address addr;
        assembly {
            addr := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(extcodesize(addr)) {
                revert(0, 0)
            }
        }
        emit Deployed(addr, salt);
        return addr;
    }

    function computeAddress(bytes memory bytecode, bytes32 salt) external view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(bytecode)
            )
        );
        return address(uint160(uint256(hash)));
    }
}

contract DeployDeterministic is Script {
    // Fixed salt for deterministic deployment
    bytes32 constant SALT = keccak256("QIPRegistry.v1");
    
    // Expected deterministic addresses (based on Anvil's deployment order)
    address constant EXPECTED_FACTORY = 0x8615aCD086FEE64F11C7F00efBaD832DE7C5F216;
    address constant EXPECTED_REGISTRY = 0xA8Fe3FFF47F517a8e0d0f3a9093Bc4D73ee75CBF;
    
    function run() public {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        vm.startBroadcast(deployerPrivateKey);
        
        // Check if factory exists, deploy if not
        Create2Factory factory;
        if (EXPECTED_FACTORY.code.length == 0) {
            factory = new Create2Factory();
            console.log("Create2Factory deployed at:", address(factory));
            require(address(factory) == EXPECTED_FACTORY, "Factory address mismatch");
        } else {
            factory = Create2Factory(EXPECTED_FACTORY);
            console.log("Create2Factory already deployed at:", EXPECTED_FACTORY);
        }
        
        // Check if registry exists, deploy if not
        if (EXPECTED_REGISTRY.code.length == 0) {
            bytes memory bytecode = type(QIPRegistry).creationCode;
            address registry = factory.deploy(bytecode, SALT);
            console.log("QIPRegistry deployed at:", registry);
            
            // Verify it matches expected address
            address computed = factory.computeAddress(bytecode, SALT);
            console.log("Computed address:", computed);
            require(registry == EXPECTED_REGISTRY, "Registry address mismatch");
        } else {
            console.log("QIPRegistry already deployed at:", EXPECTED_REGISTRY);
        }
        
        vm.stopBroadcast();
    }
}