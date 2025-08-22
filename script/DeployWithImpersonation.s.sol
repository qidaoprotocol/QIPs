// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

/**
 * @title Deploy with Impersonation and CREATE2
 * @notice Uses impersonation to deploy as any address and get deterministic addresses
 * @dev Perfect for local development to predict production deployment addresses
 */
contract DeployWithImpersonation is Script {
    // Standard CREATE2 deployer address (exists on most chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    
    // Salt for deterministic deployment
    bytes32 constant SALT = keccak256("QIPRegistry.v1.base");
    
    /**
     * @notice Deploy using impersonation
     * @dev Uses vm.startPrank to impersonate the deployer address
     */
    function runWithImpersonation() public returns (address) {
        // Get the address to impersonate from env var
        address impersonateAddress = vm.envAddress("IMPERSONATE_ADDRESS");
        address initialAdmin = vm.envOr("INITIAL_ADMIN", impersonateAddress);
        
        console.log("====================================");
        console.log("Impersonation Deployment");
        console.log("====================================");
        console.log("Impersonating address:", impersonateAddress);
        console.log("Initial admin:", initialAdmin);
        
        // Get the bytecode with constructor args
        bytes memory bytecode = abi.encodePacked(
            type(QIPRegistry).creationCode, 
            abi.encode(209, initialAdmin)
        );
        
        // Compute the expected address
        address expectedAddress = computeCreate2Address(bytecode, SALT);
        console.log("Expected QIPRegistry address:", expectedAddress);
        
        // Check if already deployed
        if (expectedAddress.code.length > 0) {
            console.log("QIPRegistry already deployed at:", expectedAddress);
            return expectedAddress;
        }
        
        // Start impersonation
        vm.startPrank(impersonateAddress);
        
        // Deal ETH to the impersonated address for gas
        vm.deal(impersonateAddress, 100 ether);
        
        // Deploy using CREATE2 via the impersonated address
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
        
        vm.stopPrank();
        
        console.log("====================================");
        console.log("Deployment successful!");
        console.log("Registry address:", deployedAddress);
        console.log("Admin address:", initialAdmin);
        console.log("====================================");
        
        return deployedAddress;
    }
    
    /**
     * @notice Just compute the address without deploying
     * @dev Useful for getting the address that WOULD be deployed
     */
    function computeAddressOnly() public view returns (address) {
        address deployerAddress = vm.envAddress("IMPERSONATE_ADDRESS");
        address initialAdmin = vm.envOr("INITIAL_ADMIN", deployerAddress);
        
        console.log("====================================");
        console.log("Computing Deployment Address");
        console.log("====================================");
        console.log("For deployer:", deployerAddress);
        console.log("With admin:", initialAdmin);
        
        bytes memory bytecode = abi.encodePacked(
            type(QIPRegistry).creationCode, 
            abi.encode(209, initialAdmin)
        );
        
        address expectedAddress = computeCreate2Address(bytecode, SALT);
        
        console.log("------------------------------------");
        console.log("Computed registry address:", expectedAddress);
        console.log("====================================");
        
        return expectedAddress;
    }
    
    /**
     * @notice Batch compute addresses for multiple deployers
     * @dev Useful for checking addresses for different wallets
     */
    function computeAddressesForMultiple() public view {
        console.log("====================================");
        console.log("Computing Addresses for Multiple Deployers");
        console.log("====================================");
        
        // Common test addresses
        address[4] memory testAddresses = [
            0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266, // Anvil account 0
            0x70997970C51812dc3A010C7d01b50e0d17dc79C8, // Anvil account 1
            0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, // Anvil account 2
            0x90F79bf6EB2c4f870365E785982E1f101E93b906  // Anvil account 3
        ];
        
        string[4] memory labels = [
            "Anvil Account 0",
            "Anvil Account 1", 
            "Anvil Account 2",
            "Anvil Account 3"
        ];
        
        for (uint i = 0; i < testAddresses.length; i++) {
            bytes memory bytecode = abi.encodePacked(
                type(QIPRegistry).creationCode, 
                abi.encode(209, testAddresses[i])
            );
            
            address addr = computeCreate2Address(bytecode, SALT);
            console.log(string.concat(labels[i], ":"));
            console.log("  Deployer/Admin:", testAddresses[i]);
            console.log("  Registry Address:", addr);
            console.log("");
        }
        
        // Also compute for any custom address if provided
        try vm.envAddress("CUSTOM_ADDRESS") returns (address customAddr) {
            bytes memory bytecode = abi.encodePacked(
                type(QIPRegistry).creationCode, 
                abi.encode(209, customAddr)
            );
            
            address addr = computeCreate2Address(bytecode, SALT);
            console.log("Custom Address:");
            console.log("  Deployer/Admin:", customAddr);
            console.log("  Registry Address:", addr);
        } catch {
            // No custom address provided
        }
        
        console.log("====================================");
    }
    
    /**
     * @notice Computes the CREATE2 address
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
     * @notice Get expected address for a specific admin
     */
    function getExpectedAddressFor(address initialAdmin) public pure returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(QIPRegistry).creationCode, 
            abi.encode(209, initialAdmin)
        );
        return computeCreate2Address(bytecode, SALT);
    }
}