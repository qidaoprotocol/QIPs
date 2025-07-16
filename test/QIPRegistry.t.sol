// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../contracts/QIPRegistry.sol";
import "../contracts/QIPGovernance.sol";

contract QIPRegistryTest is Test {
    QIPRegistry public registry;
    QIPGovernance public governance;
    
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
        registry = new QIPRegistry();
        governance = new QIPGovernance(address(registry));
        
        // Transfer governance control to the governance contract
        registry.transferGovernance(address(governance));
    }
    
    function test_CreateQIP() public {
        vm.startPrank(alice);
        
        string memory title = "Improve QiDAO Collateral Framework";
        string memory network = "Polygon";
        bytes32 contentHash = keccak256("Full proposal content here...");
        string memory ipfsUrl = "ipfs://QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
        
        vm.expectEmit(true, true, false, true);
        emit QIPCreated(249, alice, title, network, contentHash, ipfsUrl);
        
        uint256 qipNumber = registry.createQIP(title, network, contentHash, ipfsUrl);
        assertEq(qipNumber, 249);
        
        // Verify QIP details
        (
            uint256 returnedNumber,
            address author,
            string memory returnedTitle,
            string memory returnedNetwork,
            bytes32 returnedHash,
            string memory returnedUrl,
            uint256 createdAt,
            uint256 lastUpdated,
            QIPRegistry.QIPStatus status,
            string memory implementor,
            uint256 implementationDate,
            string memory snapshotId,
            uint256 version
        ) = registry.qips(qipNumber);
        
        assertEq(returnedNumber, 249);
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
        vm.startPrank(address(this)); // Contract deployer is admin
        
        // Grant editor role to Bob
        governance.grantRole(bob, QIPGovernance.Role.Editor, 0, "Trusted editor");
        
        // Grant reviewer role to Charlie
        governance.grantRole(charlie, QIPGovernance.Role.Reviewer, 30 days, "Temp reviewer");
        
        vm.stopPrank();
        
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
        
        // Charlie (reviewer) can submit review
        vm.startPrank(charlie);
        governance.submitReview(qipNumber, "Looks good", true);
        vm.stopPrank();
    }
    
    function test_MigrateExistingQIP() public {
        vm.startPrank(address(this)); // Admin
        
        // Grant editor role
        governance.grantRole(alice, QIPGovernance.Role.Editor, 0, "Migration helper");
        
        vm.stopPrank();
        
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
        (uint256 num, address author,,,,,,,QIPRegistry.QIPStatus status,,,) = registry.qips(existingQipNumber);
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
        vm.expectRevert("Already submitted to Snapshot");
        registry.updateQIP(qipNumber, "New Title", keccak256("new"), "ipfs://new", "Should fail");
        
        vm.stopPrank();
    }
    
    function test_ReviewWorkflow() public {
        vm.startPrank(address(this));
        
        // Setup reviewers
        governance.grantRole(bob, QIPGovernance.Role.Reviewer, 0, "Reviewer 1");
        governance.grantRole(charlie, QIPGovernance.Role.Reviewer, 0, "Reviewer 2");
        governance.setRequiredReviews(2);
        
        vm.stopPrank();
        
        // Create and submit for review
        vm.startPrank(alice);
        uint256 qipNumber = registry.createQIP(
            "Review Test",
            "Base",
            keccak256("content"),
            "ipfs://test"
        );
        
        // Wait minimum period
        vm.warp(block.timestamp + 3 days + 1);
        governance.requestReview(qipNumber);
        vm.stopPrank();
        
        // First approval
        vm.prank(bob);
        governance.submitReview(qipNumber, "LGTM", true);
        
        // Status should still be ReviewPending
        (,,,,,,,, QIPRegistry.QIPStatus status,,,) = registry.qips(qipNumber);
        assertEq(uint(status), uint(QIPRegistry.QIPStatus.ReviewPending));
        
        // Second approval triggers status change
        vm.prank(charlie);
        governance.submitReview(qipNumber, "Approved", true);
        
        // Status should now be VotePending
        (,,,,,,,, status,,,) = registry.qips(qipNumber);
        assertEq(uint(status), uint(QIPRegistry.QIPStatus.VotePending));
    }
}