# New QIP Workflow: Decentralized Proposal System

## Overview

The QiDAO Improvement Proposal (QIP) system has transitioned from a GitHub PR-based workflow to a fully decentralized system using:
- **On-chain registry** on Base for proposal metadata and status tracking
- **IPFS storage** for full proposal content
- **Web-based interface** for creating and editing proposals

## Key Benefits

1. **No GitHub Account Required**: Anyone with a wallet can create proposals
2. **Decentralized Storage**: Proposals stored permanently on IPFS
3. **On-chain Verification**: All proposals have verifiable on-chain records
4. **Direct Snapshot Integration**: Submit to Snapshot directly from the web interface
5. **Version Control**: All edits tracked on-chain with IPFS history

## How to Create a New QIP

### 1. Connect Your Wallet
- Visit the QIPs website
- Connect your wallet (MetaMask, WalletConnect, etc.)
- Ensure you're on Base network

### 2. Create Proposal
- Navigate to "Create Proposal" page
- Fill in the required fields:
  - **Title**: Clear, descriptive title
  - **Network**: Target network (Polygon, Ethereum, Base, etc.)
  - **Content**: Full proposal in markdown format
  - **Implementor**: Who will implement (or "None")

### 3. Submit to Blockchain
- Click "Create QIP"
- Approve the transaction in your wallet
- Your proposal will be:
  - Uploaded to IPFS
  - Registered on-chain with a unique QIP number
  - Set to "Draft" status

### 4. Edit Your Proposal
- You can edit your proposal while it's in "Draft" or "Review" status
- Each edit creates a new version on IPFS
- Edit history is tracked on-chain

### 5. Request Review
- When ready, request review from the governance team
- Reviewers will provide feedback
- Make any necessary edits

### 6. Submit to Snapshot
- Once approved for voting, submit to Snapshot
- This links your QIP to a Snapshot proposal
- Status automatically updates to "Vote Pending"

## Proposal Lifecycle

```
Draft → Review Pending → Vote Pending → Approved/Rejected → Implemented
```

- **Draft**: Initial creation, editable by author
- **Review Pending**: Under review by governance team
- **Vote Pending**: Submitted to Snapshot for voting
- **Approved**: Passed community vote
- **Rejected**: Failed community vote
- **Implemented**: Successfully implemented on-chain

## Technical Details

### Smart Contracts
- **QIPRegistry**: Main registry contract storing proposal metadata
- **QIPGovernance**: Role management and review workflow

### IPFS Providers
The system supports multiple IPFS providers:
- **NFT.Storage** (recommended): Unlimited free storage
- **Web3.Storage**: 1TB free storage
- **Pinata**: 1GB free storage

### Gas Costs
- Creating a proposal: ~50,000 gas
- Updating a proposal: ~40,000 gas
- Significantly cheaper than storing content on-chain

## Role-Based Permissions

- **Proposer**: Can create and edit own proposals
- **Reviewer**: Can review and approve proposals
- **Editor**: Can update any proposal status
- **Admin**: Full system control

## Migration from GitHub

Existing QIPs have been migrated to the new system:
- All historical QIPs preserved on IPFS
- Original metadata maintained
- GitHub links preserved for reference

## FAQ

**Q: Do I need coding knowledge to create a QIP?**
A: No, just basic markdown formatting knowledge.

**Q: What happens to my proposal after creation?**
A: It's permanently stored on IPFS and registered on-chain.

**Q: Can I delete a proposal?**
A: No, but you can withdraw it by updating the status.

**Q: How much does it cost?**
A: Only gas fees for blockchain transactions (typically < $1 on Base).

**Q: Can I edit after Snapshot submission?**
A: No, proposals are locked once submitted to Snapshot.

## Support

For technical issues or questions:
- Discord: #governance channel
- GitHub: Create an issue (for technical problems only)