// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

/**
 * @title Deploy with Standard CREATE2 Deployer
 * @notice Uses the standard CREATE2 deployer at 0x4e59b44847b379578588920ca78fbf26c0b4956c
 * @dev This deployer exists on most EVM chains including Base
 */
contract DeployWithStandardCreate2 is Script {
    // Standard CREATE2 deployer address (exists on most chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    
    // Salt for deterministic deployment
    bytes32 constant SALT = keccak256("QIPRegistry.v1.base");
    
    function run() public returns (address) {
        uint256 deployerPrivateKey = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
        
        // Get the bytecode with constructor args
        // Start at QIP 209 to allow migration of existing QIPs
        // Pass the initial admin address
        address initialAdmin = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        bytes memory bytecode = abi.encodePacked(type(QIPRegistry).creationCode, abi.encode(209, initialAdmin));
        
        // Compute the expected address
        address expectedAddress = computeCreate2Address(bytecode, SALT);
        console.log("Expected QIPRegistry address:", expectedAddress);
        
        // Check if already deployed
        if (expectedAddress.code.length > 0) {
            console.log("QIPRegistry already deployed at:", expectedAddress);
            return expectedAddress;
        }
        
        // Deploy using CREATE2
        vm.startBroadcast(deployerPrivateKey);
        
        // Call the CREATE2 deployer
        // The deployer expects: salt (32 bytes) + initcode
        bytes memory payload = abi.encodePacked(SALT, bytecode);
        
        (bool success, bytes memory result) = CREATE2_DEPLOYER.call(payload);
        require(success, "CREATE2 deployment failed");
        
        // The deployer returns the deployed address
        address deployedAddress = address(uint160(bytes20(result)));
        
        console.log("QIPRegistry deployed at:", deployedAddress);
        require(deployedAddress == expectedAddress, "Deployed address mismatch");
        
        // Verify admin role was granted correctly
        QIPRegistry registry = QIPRegistry(deployedAddress);
        require(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), initialAdmin), "Admin not set correctly");
        
        vm.stopBroadcast();
        
        return deployedAddress;
    }
    
    /**
     * @notice Computes the CREATE2 address for the registry
     * @param bytecode The contract bytecode
     * @param salt The salt value
     * @return The computed address
     */
    function computeCreate2Address(bytes memory bytecode, bytes32 salt) public pure returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                CREATE2_DEPLOYER,
                salt,
                keccak256(bytecode)
            )
        );
        return address(uint160(uint256(hash)));
    }
    
    /**
     * @notice Helper to get the expected registry address without deploying
     */
    function getExpectedAddress() public pure returns (address) {
        address initialAdmin = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        bytes memory bytecode = abi.encodePacked(type(QIPRegistry).creationCode, abi.encode(209, initialAdmin));
        return computeCreate2Address(bytecode, SALT);
    }
}