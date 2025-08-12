// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/access/IAccessControl.sol";
import "../contracts/QIPRegistry.sol";

contract QIPRegistryTest is Test {
    QIPRegistry public registry;
    
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public charlie = makeAddr("charlie");
    
    event QIPCreated(
        uint256 indexed qipNumber,
        address indexed author,
        string title,
        string network,
        bytes32 contentHash,
        string ipfsUrl
    );
    
    function setUp() public {
        // Start QIP numbers at 209 and set this test contract as governance
        registry = new QIPRegistry(209, address(this));
    }
    
    function test_CreateQIP() public {
        vm.startPrank(alice);
        
        string memory title = "Improve QiDAO Collateral Framework";
        string memory network = "Polygon";
        bytes32 contentHash = keccak256("Full proposal content here...");
        string memory ipfsUrl = "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
        
        vm.expectEmit(true, true, false, true);
        emit QIPCreated(209, alice, title, network, contentHash, ipfsUrl);
        
        uint256 qipNumber = registry.createQIP(title, network, contentHash, ipfsUrl);
        assertEq(qipNumber, 209);
        
        // Verify QIP details
        (
            uint256 returnedNumber,
            address author,
            string memory returnedTitle,
            string memory returnedNetwork,
            bytes32 returnedHash,
            string memory returnedUrl,,,
            QIPRegistry.QIPStatus status,,,,
            uint256 version
        ) = registry.qips(qipNumber);
        
        assertEq(returnedNumber, 209);
        assertEq(author, alice);
        assertEq(returnedTitle, title);
        assertEq(returnedNetwork, network);
        assertEq(returnedHash, contentHash);
        assertEq(returnedUrl, ipfsUrl);
        assertEq(uint(status), uint(QIPRegistry.QIPStatus.Draft));
        assertEq(version, 1);
        
        vm.stopPrank();
    }
    
    function test_UpdateQIP() public {
        vm.startPrank(alice);
        
        // Create QIP
        uint256 qipNumber = registry.createQIP(
            "Original Title",
            "Polygon",
            keccak256("Original content"),
            "ipfs://original"
        );
        
        // Update QIP
        string memory newTitle = "Updated Title";
        bytes32 newHash = keccak256("Updated content");
        string memory newUrl = "ipfs://updated";
        
        registry.updateQIP(qipNumber, newTitle, newHash, newUrl, "Fixed typos");
        
        // Verify update
        (,, string memory title,,bytes32 hash, string memory url,,,,,,,uint256 version) = registry.qips(qipNumber);
        assertEq(title, newTitle);
        assertEq(hash, newHash);
        assertEq(url, newUrl);
        assertEq(version, 2);
        
        vm.stopPrank();
    }
    
    function test_RoleBasedAccess() public {
        // Grant editor role to Bob (only governance can call)
        registry.setEditor(bob, true);

        // Alice creates a QIP
        vm.startPrank(alice);
        uint256 qipNumber = registry.createQIP(
            "Test Proposal",
            "Base",
            keccak256("content"),
            "ipfs://test"
        );
        vm.stopPrank();

        // Bob (editor) can update status
        vm.startPrank(bob);
        registry.updateStatus(qipNumber, QIPRegistry.QIPStatus.ReviewPending);
        vm.stopPrank();

        // Charlie (non-editor) cannot update status
        vm.startPrank(charlie);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                charlie,
                registry.EDITOR_ROLE()
            )
        );
        registry.updateStatus(qipNumber, QIPRegistry.QIPStatus.Approved);
        vm.stopPrank();
    }
    
    function test_MigrateExistingQIP() public {
        // Grant editor role
        registry.setEditor(alice, true);
        
        // Migrate an existing QIP
        vm.startPrank(alice);
        
        uint256 existingQipNumber = 123;
        registry.migrateQIP(
            existingQipNumber,
            bob, // original author
            "Historical QIP Title",
            "Ethereum",
            keccak256("historical content"),
            "ipfs://historical",
            1640995200, // Jan 1, 2022
            QIPRegistry.QIPStatus.Implemented,
            "Dev Team",
            1641600000, // Jan 8, 2022
            "snapshot-proposal-id"
        );
        
        // Verify migration
        (
            uint256 num,
            address author,
            , , , , , ,
            QIPRegistry.QIPStatus status,
            , , ,
        ) = registry.qips(existingQipNumber);
        assertEq(num, existingQipNumber);
        assertEq(author, bob);
        assertEq(uint(status), uint(QIPRegistry.QIPStatus.Implemented));
        
        vm.stopPrank();
    }
    
    function test_SnapshotIntegration() public {
        vm.startPrank(alice);
        
        uint256 qipNumber = registry.createQIP(
            "Snapshot Test",
            "Polygon",
            keccak256("content"),
            "ipfs://test"
        );
        
        // Link snapshot proposal
        string memory snapshotId = "0x1234567890abcdef";
        registry.linkSnapshotProposal(qipNumber, snapshotId);
        
        // Verify status changed and snapshot linked
        (,,,,,,,, QIPRegistry.QIPStatus status,,, string memory linkedId,) = registry.qips(qipNumber);
        assertEq(uint(status), uint(QIPRegistry.QIPStatus.VotePending));
        assertEq(linkedId, snapshotId);
        
        // Cannot update after snapshot submission
        vm.expectRevert("Cannot update after voting");
        registry.updateQIP(qipNumber, "New Title", keccak256("new"), "ipfs://new", "Should fail");
        
        vm.stopPrank();
    }
    
    function test_ReviewWorkflow() public {
        // Setup editor
        registry.setEditor(bob, true);

        // Create and submit for review
        vm.startPrank(alice);
        uint256 qipNumber = registry.createQIP(
            "Review Test",
            "Base",
            keccak256("content"),
            "ipfs://test"
        );
        
        // Stop Alice prank before switching actors
        vm.stopPrank();
        // Editor moves status to ReviewPending
        vm.prank(bob);
        registry.updateStatus(qipNumber, QIPRegistry.QIPStatus.ReviewPending);
        
        // Editor moves status to VotePending
        vm.prank(bob);
        registry.updateStatus(qipNumber, QIPRegistry.QIPStatus.VotePending);
        
        // Status should now be VotePending
        (
            , , , , , , , ,
            QIPRegistry.QIPStatus status,
            , , ,
        ) = registry.qips(qipNumber);
        assertEq(uint(status), uint(QIPRegistry.QIPStatus.VotePending));
    }

    function test_PausePreventsCreation() public {
        // Pause by admin (DEFAULT_ADMIN_ROLE granted to this test via constructor argument)
        registry.pause();

        // Creating a QIP should revert while paused
        vm.prank(alice);
        // OZ Pausable uses custom error EnforcedPause(); expect revert on create
        vm.expectRevert();
        registry.createQIP(
            "Paused Test",
            "Base",
            keccak256("content"),
            "ipfs://paused"
        );

        // Unpause and try again
        registry.unpause();
        vm.prank(alice);
        uint256 qipNumber = registry.createQIP(
            "Unpaused Test",
            "Base",
            keccak256("content"),
            "ipfs://ok"
        );
        assertEq(qipNumber, 209);
    }
}