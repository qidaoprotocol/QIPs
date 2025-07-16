// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "./QIPRegistry.sol";

/**
 * @title QIPGovernance
 * @notice Advanced governance features for QIP management
 * @dev Extends QIPRegistry with role-based permissions and automated workflows
 */
contract QIPGovernance {
    QIPRegistry public immutable registry;
    
    enum Role {
        None,
        Proposer,
        Reviewer,
        Editor,
        Admin
    }
    
    struct RoleAssignment {
        Role role;
        uint256 assignedAt;
        uint256 expiresAt;
        string reason;
    }
    
    struct ReviewComment {
        address reviewer;
        uint256 timestamp;
        string comment;
        bool isApproval;
    }
    
    mapping(address => RoleAssignment) public roles;
    mapping(uint256 => ReviewComment[]) public qipReviews;
    mapping(uint256 => mapping(address => bool)) public hasReviewed;
    
    uint256 public constant MIN_REVIEW_PERIOD = 3 days;
    uint256 public constant MAX_DRAFT_PERIOD = 30 days;
    uint256 public requiredReviews = 2;
    
    event RoleGranted(address indexed user, Role role, uint256 expiresAt, string reason);
    event RoleRevoked(address indexed user, Role previousRole, string reason);
    event ReviewSubmitted(uint256 indexed qipNumber, address indexed reviewer, bool isApproval);
    event AutoStatusUpdate(uint256 indexed qipNumber, QIPRegistry.QIPStatus newStatus, string reason);
    
    modifier onlyRole(Role _minRole) {
        require(roles[msg.sender].role >= _minRole, "Insufficient role");
        require(roles[msg.sender].expiresAt == 0 || roles[msg.sender].expiresAt > block.timestamp, "Role expired");
        _;
    }
    
    modifier onlyAdmin() {
        require(roles[msg.sender].role == Role.Admin, "Only admin");
        require(roles[msg.sender].expiresAt == 0 || roles[msg.sender].expiresAt > block.timestamp, "Role expired");
        _;
    }
    
    constructor(address _registry) {
        registry = QIPRegistry(_registry);
        
        // Grant admin role to deployer
        roles[msg.sender] = RoleAssignment({
            role: Role.Admin,
            assignedAt: block.timestamp,
            expiresAt: 0, // No expiration
            reason: "Contract deployer"
        });
    }
    
    /**
     * @dev Grant role to a user
     */
    function grantRole(
        address _user,
        Role _role,
        uint256 _duration,
        string memory _reason
    ) external onlyAdmin {
        require(_user != address(0), "Invalid address");
        require(_role != Role.None, "Cannot grant None role");
        
        uint256 expiresAt = _duration > 0 ? block.timestamp + _duration : 0;
        
        roles[_user] = RoleAssignment({
            role: _role,
            assignedAt: block.timestamp,
            expiresAt: expiresAt,
            reason: _reason
        });
        
        // Sync editor status with registry
        if (_role >= Role.Editor) {
            registry.setEditor(_user, true);
        } else {
            registry.setEditor(_user, false);
        }
        
        emit RoleGranted(_user, _role, expiresAt, _reason);
    }
    
    /**
     * @dev Revoke role from a user
     */
    function revokeRole(address _user, string memory _reason) external onlyAdmin {
        Role previousRole = roles[_user].role;
        require(previousRole != Role.None, "User has no role");
        
        delete roles[_user];
        registry.setEditor(_user, false);
        
        emit RoleRevoked(_user, previousRole, _reason);
    }
    
    /**
     * @dev Submit a review for a QIP
     */
    function submitReview(
        uint256 _qipNumber,
        string memory _comment,
        bool _isApproval
    ) external onlyRole(Role.Reviewer) {
        (QIPRegistry.QIP memory qip,) = registry.getQIPWithVersions(_qipNumber);
        require(qip.qipNumber > 0, "QIP does not exist");
        require(qip.status == QIPRegistry.QIPStatus.ReviewPending, "Not in review");
        require(!hasReviewed[_qipNumber][msg.sender], "Already reviewed");
        
        qipReviews[_qipNumber].push(ReviewComment({
            reviewer: msg.sender,
            timestamp: block.timestamp,
            comment: _comment,
            isApproval: _isApproval
        }));
        
        hasReviewed[_qipNumber][msg.sender] = true;
        
        emit ReviewSubmitted(_qipNumber, msg.sender, _isApproval);
        
        // Check if enough approvals to move to vote pending
        _checkReviewThreshold(_qipNumber);
    }
    
    /**
     * @dev Check if QIP has enough reviews to proceed
     */
    function _checkReviewThreshold(uint256 _qipNumber) internal {
        uint256 approvals = 0;
        uint256 rejections = 0;
        
        ReviewComment[] storage reviews = qipReviews[_qipNumber];
        for (uint256 i = 0; i < reviews.length; i++) {
            if (reviews[i].isApproval) {
                approvals++;
            } else {
                rejections++;
            }
        }
        
        if (approvals >= requiredReviews) {
            registry.updateStatus(_qipNumber, QIPRegistry.QIPStatus.VotePending);
            emit AutoStatusUpdate(_qipNumber, QIPRegistry.QIPStatus.VotePending, "Required reviews reached");
        } else if (rejections > requiredReviews) {
            registry.updateStatus(_qipNumber, QIPRegistry.QIPStatus.Rejected);
            emit AutoStatusUpdate(_qipNumber, QIPRegistry.QIPStatus.Rejected, "Too many rejections");
        }
    }
    
    /**
     * @dev Request review for a QIP
     */
    function requestReview(uint256 _qipNumber) external {
        (QIPRegistry.QIP memory qip,) = registry.getQIPWithVersions(_qipNumber);
        require(qip.qipNumber > 0, "QIP does not exist");
        require(qip.author == msg.sender || roles[msg.sender].role >= Role.Editor, "Not authorized");
        require(qip.status == QIPRegistry.QIPStatus.Draft, "Not in draft");
        require(block.timestamp >= qip.createdAt + MIN_REVIEW_PERIOD, "Too soon for review");
        
        registry.updateStatus(_qipNumber, QIPRegistry.QIPStatus.ReviewPending);
        emit AutoStatusUpdate(_qipNumber, QIPRegistry.QIPStatus.ReviewPending, "Review requested");
    }
    
    /**
     * @dev Check and update stale QIPs
     */
    function checkStaleQIPs(uint256[] calldata _qipNumbers) external {
        for (uint256 i = 0; i < _qipNumbers.length; i++) {
            (QIPRegistry.QIP memory qip,) = registry.getQIPWithVersions(_qipNumbers[i]);
            
            if (qip.status == QIPRegistry.QIPStatus.Draft && 
                block.timestamp > qip.lastUpdated + MAX_DRAFT_PERIOD) {
                registry.updateStatus(_qipNumbers[i], QIPRegistry.QIPStatus.Withdrawn);
                emit AutoStatusUpdate(_qipNumbers[i], QIPRegistry.QIPStatus.Withdrawn, "Stale draft");
            }
        }
    }
    
    /**
     * @dev Update required reviews threshold
     */
    function setRequiredReviews(uint256 _required) external onlyAdmin {
        require(_required > 0, "Must require at least 1 review");
        requiredReviews = _required;
    }
    
    /**
     * @dev Get all reviews for a QIP
     */
    function getQIPReviews(uint256 _qipNumber) external view returns (ReviewComment[] memory) {
        return qipReviews[_qipNumber];
    }
    
    /**
     * @dev Check if address has valid role
     */
    function hasValidRole(address _user, Role _minRole) external view returns (bool) {
        RoleAssignment memory assignment = roles[_user];
        return assignment.role >= _minRole && 
               (assignment.expiresAt == 0 || assignment.expiresAt > block.timestamp);
    }
    
    /**
     * @dev Batch grant roles
     */
    function batchGrantRoles(
        address[] calldata _users,
        Role[] calldata _roles,
        uint256[] calldata _durations,
        string memory _reason
    ) external onlyAdmin {
        require(_users.length == _roles.length && _roles.length == _durations.length, "Array length mismatch");
        
        for (uint256 i = 0; i < _users.length; i++) {
            require(_users[i] != address(0), "Invalid address");
            require(_roles[i] != Role.None, "Cannot grant None role");
            
            uint256 expiresAt = _durations[i] > 0 ? block.timestamp + _durations[i] : 0;
            
            roles[_users[i]] = RoleAssignment({
                role: _roles[i],
                assignedAt: block.timestamp,
                expiresAt: expiresAt,
                reason: _reason
            });
            
            if (_roles[i] >= Role.Editor) {
                registry.setEditor(_users[i], true);
            } else {
                registry.setEditor(_users[i], false);
            }
            
            emit RoleGranted(_users[i], _roles[i], expiresAt, _reason);
        }
    }
    
    /**
     * @dev Emergency pause for specific QIP
     */
    function emergencyWithdrawQIP(uint256 _qipNumber, string memory _reason) 
        external 
        onlyAdmin 
    {
        registry.updateStatus(_qipNumber, QIPRegistry.QIPStatus.Withdrawn);
        emit AutoStatusUpdate(_qipNumber, QIPRegistry.QIPStatus.Withdrawn, _reason);
    }
}