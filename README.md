# QIPs (QiDAO Improvement Proposals)

## Description
The QIPs platform is a decentralized system for the QiDAO community to propose, discuss, and track protocol improvements. Proposals are stored on IPFS with an on-chain registry on Base, ensuring transparency, permanence, and permissionless access.

## 🆕 New Decentralized Workflow
QIPs now use a fully on-chain system instead of GitHub PRs:
- **Create proposals** directly through the web interface
- **Store content** permanently on IPFS
- **Track status** via on-chain registry
- **Submit to Snapshot** with one click

See [NEW_QIP_WORKFLOW.md](docs/NEW_QIP_WORKFLOW.md) for detailed instructions.

## Stages:
1. **Draft:** Initial proposal submission for community review.
2. **Discussion:** Open forum for community feedback and deliberation.
3. **Voting:** Community vote to approve or reject the proposal.
4. **Accepted:** Approved proposals awaiting implementation.
5. **Queued:** In Progress of being implemented
6. **Implemented:** Successfully integrated proposals into the QiDAO protocol.
7. **Rejected:** Proposals that were not approved by the community.

## Pages Required:
1. **Homepage:**
   - Overview of QIPs, recent proposals, and a guide on how to contribute.
   
2. **All Proposals Page:**
   - A comprehensive list of proposals with filtering and sorting options.
   
3. **Individual Proposal Pages:**
   - Detailed view of each proposal, its status, discussion threads, and voting results.
   
4. **Contribution Guide Page:**
   - Step-by-step guide on how to submit new proposals and participate in discussions.
   
5. **FAQ/Help Page:**
   - Assistance for common queries and guidelines on community conduct.

## Local Testing with QIP Registry

### Quick Start

1. **Start local test environment:**
```bash
# Basic setup with test QIPs (249-251)
bun run dev:local

# Or with migration of existing QIPs (209-248)
bun run dev:local -- --migrate
```

This will:
- Start IPFS daemon (required for local development)
- Start Anvil (local Ethereum node forked from Base)
- Deploy the QIPRegistry contract (starting at QIP 209)
- Create sample QIPs (249-251) with different statuses
- Optionally migrate existing QIPs (209-248) with their original numbers
- Set up test accounts with roles (governance, editor, authors)
- Start Gatsby development server

2. **Run the TypeScript test client:**
```bash
bun run src/localQIPTest.ts
```

### Test Accounts

| Role | Address | Private Key (first 16 chars) |
|------|---------|------------------------------|
| Governance | 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 | 0xac0974bec39a17... |
| Editor | 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 | 0x47e179ec197488... |
| Author1 | 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC | 0x59c6995e998f97... |
| Author2 | 0x90F79bf6EB2c4f870365E785982E1f101E93b906 | 0x5de4111afa1a4b... |
| Author3 | 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 | 0x7c852118294e51... |

### Pre-deployed Test QIPs

The setup script creates several QIPs to demonstrate different states:

- **QIP-249**: Dynamic Interest Rates (Draft → Implemented)
- **QIP-250**: Multi-Collateral Support (Draft → ReviewPending)
- **QIP-251**: Staking Rewards (Draft → Withdrawn)
- **QIP-100**: Historical - Protocol Launch (Implemented)
- **QIP-150**: Historical - Rejected Proposal (Rejected)
- **QIP-200**: Historical - Superseded Update (Superseded)

### Testing Scenarios

1. **Create a new QIP:**
```typescript
import { generateQIPContent } from './src/testHelpers';

const qipData = generateQIPContent(252, 'technicalUpgrade');
await registry.write.createQIP([
  qipData.title,
  qipData.network,
  qipData.contentHash,
  qipData.ipfsUrl
]);
```

2. **Update QIP status (Editor only):**
```bash
cast send $REGISTRY_ADDRESS "updateStatus(uint256,uint8)" 249 3 \
  --private-key $EDITOR_KEY --rpc-url http://localhost:8545
```

3. **Query QIPs:**
```bash
# Get QIPs by status (e.g., Draft = 0)
cast call $REGISTRY_ADDRESS "getQIPsByStatus(uint8)" 0 --rpc-url http://localhost:8545

# Get QIPs by author
cast call $REGISTRY_ADDRESS "getQIPsByAuthor(address)" $AUTHOR1 --rpc-url http://localhost:8545
```

### Advanced Testing

Use the test helpers for complex scenarios:

```typescript
import { TestScenarios, createBatchQIPs } from './src/testHelpers';

// Create multiple QIPs at once
const results = await createBatchQIPs(registry, 260, 5);

// Run predefined test scenarios
// See TestScenarios in testHelpers.ts for available scenarios
```
   
