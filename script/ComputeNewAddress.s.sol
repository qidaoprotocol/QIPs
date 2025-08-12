// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {QIPRegistry} from "../contracts/QIPRegistry.sol";

/**
 * @title Compute New Deterministic Address
 * @notice Computes the new CREATE2 address for QIPRegistry with constructor parameter
 */
contract ComputeNewAddress is Script {
    // Standard CREATE2 deployer address (exists on most chains)
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    
    // Salt for deterministic deployment
    bytes32 constant SALT = keccak256("QIPRegistry.v1.base");
    
    function run() public pure {
        // Get the bytecode with constructor args (starting at QIP 209 with initial admin)
        address initialAdmin = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
        bytes memory bytecode = abi.encodePacked(
            type(QIPRegistry).creationCode, 
            abi.encode(209, initialAdmin)
        );
        
        // Compute the CREATE2 address
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                CREATE2_DEPLOYER,
                SALT,
                keccak256(bytecode)
            )
        );
        
        address computedAddress = address(uint160(uint256(hash)));
        
        console.log("=== QIPRegistry Deterministic Address ===");
        console.log("CREATE2 Deployer:", CREATE2_DEPLOYER);
        console.log("Salt:", vm.toString(SALT));
        console.log("Starting QIP Number:", uint256(209));
        console.log("");
        console.log("Computed Address:", computedAddress);
        console.log("Checksummed:", computedAddress);
        console.log("");
        console.log("Bytecode hash:", vm.toString(keccak256(bytecode)));
    }
}