// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/**
 * @title QIPRegistry
 * @notice On-chain registry for QiDAO Improvement Proposals stored on IPFS
 * @dev Manages QIP metadata, versioning, and status transitions
 */
contract QIPRegistry {
    struct QIP {
        uint256 qipNumber;
        address author;
        string title;
        string network;
        bytes32 contentHash;    // keccak256 of the full proposal content
        string ipfsUrl;         // IPFS CID in format: ipfs://Qm...
        uint256 createdAt;
        uint256 lastUpdated;
        QIPStatus status;
        string implementor;
        uint256 implementationDate;
        string snapshotProposalId;
        uint256 version;        // Version number for tracking edits
    }

    struct QIPVersion {
        bytes32 contentHash;
        string ipfsUrl;
        uint256 timestamp;
        string changeNote;
    }

    enum QIPStatus {
        Draft,
        ReviewPending,
        VotePending,
        Approved,
        Rejected,
        Implemented,
        Superseded,
        Withdrawn
    }

    mapping(uint256 => QIP) public qips;
    mapping(uint256 => mapping(uint256 => QIPVersion)) public qipVersions;
    mapping(uint256 => uint256) public qipVersionCount;
    mapping(bytes32 => uint256) public contentHashToQIP;
    mapping(address => uint256[]) private authorQIPs;
    mapping(address => bool) public editors;
    
    uint256 public nextQIPNumber;
    address public governance;
    bool public migrationMode = true;
    bool public paused = false;

    event QIPCreated(
        uint256 indexed qipNumber,
        address indexed author,
        string title,
        string network,
        bytes32 contentHash,
        string ipfsUrl
    );

    event QIPUpdated(
        uint256 indexed qipNumber,
        uint256 version,
        bytes32 newContentHash,
        string newIpfsUrl,
        string changeNote
    );

    event QIPStatusChanged(
        uint256 indexed qipNumber,
        QIPStatus oldStatus,
        QIPStatus newStatus
    );

    event SnapshotProposalLinked(
        uint256 indexed qipNumber,
        string snapshotProposalId
    );

    event RegistryPaused(address indexed by);
    event RegistryUnpaused(address indexed by);

    modifier onlyGovernance() {
        require(msg.sender == governance, "Only governance");
        _;
    }

    modifier onlyEditor() {
        require(editors[msg.sender] || msg.sender == governance, "Only editor");
        _;
    }

    modifier onlyAuthorOrEditor(uint256 _qipNumber) {
        require(
            qips[_qipNumber].author == msg.sender || 
            editors[msg.sender] || 
            msg.sender == governance,
            "Only author or editor"
        );
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Registry paused");
        _;
    }

    constructor(uint256 _startingQIPNumber, address _governance) {
        governance = _governance;
        editors[_governance] = true;
        nextQIPNumber = _startingQIPNumber;
    }

    /**
     * @dev Create a new QIP
     * @param _title QIP title
     * @param _network Target network (Polygon, Ethereum, Base, etc.)
     * @param _contentHash keccak256 hash of the full proposal content
     * @param _ipfsUrl IPFS URL where content is stored
     */
    function createQIP(
        string memory _title,
        string memory _network,
        bytes32 _contentHash,
        string memory _ipfsUrl
    ) external whenNotPaused returns (uint256) {
        require(bytes(_title).length > 0, "Title required");
        require(bytes(_network).length > 0, "Network required");
        require(_contentHash != bytes32(0), "Invalid content hash");
        require(bytes(_ipfsUrl).length > 0, "IPFS URL required");
        require(contentHashToQIP[_contentHash] == 0, "Content already exists");
        
        uint256 qipNumber = nextQIPNumber++;
        
        qips[qipNumber] = QIP({
            qipNumber: qipNumber,
            author: msg.sender,
            title: _title,
            network: _network,
            contentHash: _contentHash,
            ipfsUrl: _ipfsUrl,
            createdAt: block.timestamp,
            lastUpdated: block.timestamp,
            status: QIPStatus.Draft,
            implementor: "None",
            implementationDate: 0,
            snapshotProposalId: "",
            version: 1
        });
        
        // Store initial version
        qipVersions[qipNumber][1] = QIPVersion({
            contentHash: _contentHash,
            ipfsUrl: _ipfsUrl,
            timestamp: block.timestamp,
            changeNote: "Initial version"
        });
        qipVersionCount[qipNumber] = 1;
        
        contentHashToQIP[_contentHash] = qipNumber;
        authorQIPs[msg.sender].push(qipNumber);
        
        emit QIPCreated(
            qipNumber,
            msg.sender,
            _title,
            _network,
            _contentHash,
            _ipfsUrl
        );
        
        return qipNumber;
    }

    /**
     * @dev Pause new QIP creation. Editors and governance may still manage existing QIPs.
     */
    function pause() external onlyGovernance {
        paused = true;
        emit RegistryPaused(msg.sender);
    }

    /**
     * @dev Unpause new QIP creation.
     */
    function unpause() external onlyGovernance {
        paused = false;
        emit RegistryUnpaused(msg.sender);
    }

    /**
     * @dev Update QIP content (only allowed before snapshot submission)
     */
    function updateQIP(
        uint256 _qipNumber,
        string memory _title,
        bytes32 _newContentHash,
        string memory _newIpfsUrl,
        string memory _changeNote
    ) external onlyAuthorOrEditor(_qipNumber) {
        QIP storage qip = qips[_qipNumber];
        require(qip.qipNumber > 0, "QIP does not exist");
        require(
            qip.status == QIPStatus.Draft || qip.status == QIPStatus.ReviewPending,
            "Cannot update after voting"
        );
        require(bytes(qip.snapshotProposalId).length == 0, "Already submitted to Snapshot");
        require(_newContentHash != bytes32(0), "Invalid content hash");
        require(contentHashToQIP[_newContentHash] == 0, "Content already exists");
        
        // Update content hash mapping
        delete contentHashToQIP[qip.contentHash];
        contentHashToQIP[_newContentHash] = _qipNumber;
        
        // Update QIP
        qip.title = _title;
        qip.contentHash = _newContentHash;
        qip.ipfsUrl = _newIpfsUrl;
        qip.lastUpdated = block.timestamp;
        qip.version++;
        
        // Store new version
        qipVersions[_qipNumber][qip.version] = QIPVersion({
            contentHash: _newContentHash,
            ipfsUrl: _newIpfsUrl,
            timestamp: block.timestamp,
            changeNote: _changeNote
        });
        qipVersionCount[_qipNumber] = qip.version;
        
        emit QIPUpdated(
            _qipNumber,
            qip.version,
            _newContentHash,
            _newIpfsUrl,
            _changeNote
        );
    }

    /**
     * @dev Update QIP status
     */
    function updateStatus(uint256 _qipNumber, QIPStatus _newStatus) 
        external 
        onlyEditor 
    {
        QIP storage qip = qips[_qipNumber];
        require(qip.qipNumber > 0, "QIP does not exist");
        
        QIPStatus oldStatus = qip.status;
        qip.status = _newStatus;
        qip.lastUpdated = block.timestamp;
        
        emit QIPStatusChanged(_qipNumber, oldStatus, _newStatus);
    }

    /**
     * @dev Link Snapshot proposal ID
     */
    function linkSnapshotProposal(
        uint256 _qipNumber, 
        string memory _snapshotProposalId
    ) external onlyAuthorOrEditor(_qipNumber) {
        QIP storage qip = qips[_qipNumber];
        require(qip.qipNumber > 0, "QIP does not exist");
        require(bytes(qip.snapshotProposalId).length == 0, "Snapshot already linked");
        
        qip.snapshotProposalId = _snapshotProposalId;
        qip.status = QIPStatus.VotePending;
        qip.lastUpdated = block.timestamp;
        
        emit SnapshotProposalLinked(_qipNumber, _snapshotProposalId);
        emit QIPStatusChanged(_qipNumber, qip.status, QIPStatus.VotePending);
    }

    /**
     * @dev Set implementor and implementation date
     */
    function setImplementation(
        uint256 _qipNumber,
        string memory _implementor,
        uint256 _implementationDate
    ) external onlyEditor {
        QIP storage qip = qips[_qipNumber];
        require(qip.qipNumber > 0, "QIP does not exist");
        
        qip.implementor = _implementor;
        qip.implementationDate = _implementationDate;
        qip.lastUpdated = block.timestamp;
    }

    /**
     * @dev Add or remove editor
     */
    function setEditor(address _editor, bool _status) external onlyGovernance {
        editors[_editor] = _status;
    }

    /**
     * @dev Transfer governance
     */
    function transferGovernance(address _newGovernance) external onlyGovernance {
        require(_newGovernance != address(0), "Invalid address");
        governance = _newGovernance;
    }

    /**
     * @dev Disable migration mode (after migrating existing QIPs)
     */
    function disableMigrationMode() external onlyGovernance {
        migrationMode = false;
    }

    /**
     * @dev Migrate existing QIP (only during migration mode)
     */
    function migrateQIP(
        uint256 _qipNumber,
        address _author,
        string memory _title,
        string memory _network,
        bytes32 _contentHash,
        string memory _ipfsUrl,
        uint256 _createdAt,
        QIPStatus _status,
        string memory _implementor,
        uint256 _implementationDate,
        string memory _snapshotProposalId
    ) external onlyEditor {
        require(migrationMode, "Migration mode disabled");
        require(qips[_qipNumber].qipNumber == 0, "QIP already exists");
        
        qips[_qipNumber] = QIP({
            qipNumber: _qipNumber,
            author: _author,
            title: _title,
            network: _network,
            contentHash: _contentHash,
            ipfsUrl: _ipfsUrl,
            createdAt: _createdAt,
            lastUpdated: _createdAt,
            status: _status,
            implementor: _implementor,
            implementationDate: _implementationDate,
            snapshotProposalId: _snapshotProposalId,
            version: 1
        });
        
        // Store initial version
        qipVersions[_qipNumber][1] = QIPVersion({
            contentHash: _contentHash,
            ipfsUrl: _ipfsUrl,
            timestamp: _createdAt,
            changeNote: "Migrated from GitHub"
        });
        qipVersionCount[_qipNumber] = 1;
        
        contentHashToQIP[_contentHash] = _qipNumber;
        authorQIPs[_author].push(_qipNumber);
    }

    /**
     * @dev Get QIPs by author
     */
    function getQIPsByAuthor(address _author) external view returns (uint256[] memory) {
        return authorQIPs[_author];
    }

    /**
     * @dev Get QIP with all versions
     */
    function getQIPWithVersions(uint256 _qipNumber) external view returns (
        QIP memory qip,
        QIPVersion[] memory versions
    ) {
        require(qips[_qipNumber].qipNumber > 0, "QIP does not exist");
        
        qip = qips[_qipNumber];
        uint256 versionCount = qipVersionCount[_qipNumber];
        versions = new QIPVersion[](versionCount);
        
        for (uint256 i = 1; i <= versionCount; i++) {
            versions[i - 1] = qipVersions[_qipNumber][i];
        }
    }

    /**
     * @dev Verify content hash matches QIP
     */
    function verifyContent(
        uint256 _qipNumber,
        string memory _content
    ) external view returns (bool) {
        require(qips[_qipNumber].qipNumber > 0, "QIP does not exist");
        return keccak256(bytes(_content)) == qips[_qipNumber].contentHash;
    }

    /**
     * @dev Get active QIPs by status
     */
    function getQIPsByStatus(QIPStatus _status) external view returns (uint256[] memory) {
        uint256 count = 0;
        
        // First count matching QIPs
        for (uint256 i = 1; i < nextQIPNumber; i++) {
            if (qips[i].qipNumber > 0 && qips[i].status == _status) {
                count++;
            }
        }
        
        // Then populate array
        uint256[] memory result = new uint256[](count);
        uint256 index = 0;
        
        for (uint256 i = 1; i < nextQIPNumber; i++) {
            if (qips[i].qipNumber > 0 && qips[i].status == _status) {
                result[index++] = i;
            }
        }
        
        return result;
    }
}