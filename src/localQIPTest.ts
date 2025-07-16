import { createPublicClient, createWalletClient, http, parseAbi, getContract, keccak256, toHex, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Define custom chain for Base fork
const baseFork = defineChain({
  id: 8453,
  name: 'Base Fork',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
});

// Contract ABI (simplified for key functions)
const QIPRegistryABI = parseAbi([
  'function createQIP(string title, string network, bytes32 contentHash, string ipfsUrl) returns (uint256)',
  'function updateQIP(uint256 qipNumber, string title, bytes32 newContentHash, string newIpfsUrl, string changeNote)',
  'function updateStatus(uint256 qipNumber, uint8 newStatus)',
  'function linkSnapshotProposal(uint256 qipNumber, string snapshotProposalId)',
  'function setImplementation(uint256 qipNumber, string implementor, uint256 implementationDate)',
  'function qips(uint256) view returns (uint256 qipNumber, address author, string title, string network, bytes32 contentHash, string ipfsUrl, uint256 createdAt, uint256 lastUpdated, uint8 status, string implementor, uint256 implementationDate, string snapshotProposalId, uint256 version)',
  'function getQIPsByAuthor(address author) view returns (uint256[])',
  'function getQIPsByStatus(uint8 status) view returns (uint256[])',
  'function verifyContent(uint256 qipNumber, string content) view returns (bool)',
  'function nextQIPNumber() view returns (uint256)',
  'event QIPCreated(uint256 indexed qipNumber, address indexed author, string title, string network, bytes32 contentHash, string ipfsUrl)',
  'event QIPUpdated(uint256 indexed qipNumber, uint256 version, bytes32 newContentHash, string newIpfsUrl, string changeNote)',
  'event QIPStatusChanged(uint256 indexed qipNumber, uint8 oldStatus, uint8 newStatus)',
]);

// QIP Status enum
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

// Test accounts (Anvil default accounts)
const accounts = {
  governance: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
  editor: privateKeyToAccount('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'),
  author1: privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'),
  author2: privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'),
  author3: privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'),
};

// Replace with actual deployed address from forge script
const REGISTRY_ADDRESS = '0x2f282275cd4f55Ef434B12d9ed4510A8F352cC4f' as const;

async function main() {
  console.log('🚀 QIP Registry Local Testing Client');
  console.log('=====================================\n');

  // Create clients
  const publicClient = createPublicClient({
    chain: baseFork,
    transport: http('http://127.0.0.1:8545'),
  });

  // Create wallet clients for different roles
  const governanceClient = createWalletClient({
    account: accounts.governance,
    chain: baseFork,
    transport: http('http://127.0.0.1:8545'),
  });

  const author1Client = createWalletClient({
    account: accounts.author1,
    chain: baseFork,
    transport: http('http://127.0.0.1:8545'),
  });

  const author2Client = createWalletClient({
    account: accounts.author2,
    chain: baseFork,
    transport: http('http://127.0.0.1:8545'),
  });

  // Get contract instance
  const registry = getContract({
    address: REGISTRY_ADDRESS,
    abi: QIPRegistryABI,
    client: { public: publicClient, wallet: author1Client },
  });

  // 1. Check current QIP number
  console.log('📊 Current State:');
  const nextQIPNumber = await registry.read.nextQIPNumber();
  console.log(`Next QIP Number: ${nextQIPNumber}`);

  // 2. Create a new QIP
  console.log('\n📝 Creating New QIP...');
  const newQIPContent = 'QIP-249: Implement Cross-Chain Bridge Support';
  const contentHash = keccak256(toHex(newQIPContent));
  
  const txHash = await registry.write.createQIP([
    'Cross-Chain Bridge Support',
    'Multi-Chain',
    contentHash,
    'ipfs://QmTest249BridgeSupport'
  ]);
  
  console.log(`Transaction Hash: ${txHash}`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log('✅ QIP-249 Created!');

  // 3. Read QIP details
  const qip249 = await registry.read.qips([249n]);
  console.log('\n📄 QIP-249 Details:');
  console.log(`- Title: ${qip249[2]}`);
  console.log(`- Author: ${qip249[1]}`);
  console.log(`- Network: ${qip249[3]}`);
  console.log(`- Status: ${QIPStatus[Number(qip249[8])]}`);
  console.log(`- Version: ${qip249[12]}`);

  // 4. Query QIPs by author
  console.log('\n👤 QIPs by Author:');
  const author1QIPs = await registry.read.getQIPsByAuthor([accounts.author1.address]);
  console.log(`Author1 (${accounts.author1.address}) QIPs: ${author1QIPs.map(n => n.toString()).join(', ')}`);

  // 5. Query QIPs by status
  console.log('\n📊 QIPs by Status:');
  const draftQIPs = await registry.read.getQIPsByStatus([QIPStatus.Draft]);
  console.log(`Draft QIPs: ${draftQIPs.map(n => n.toString()).join(', ')}`);
  
  const implementedQIPs = await registry.read.getQIPsByStatus([QIPStatus.Implemented]);
  console.log(`Implemented QIPs: ${implementedQIPs.map(n => n.toString()).join(', ')}`);

  // 6. Verify content
  console.log('\n🔍 Content Verification:');
  const isValid = await registry.read.verifyContent([249n, newQIPContent]);
  console.log(`Content verification for QIP-249: ${isValid ? '✅ Valid' : '❌ Invalid'}`);

  // 7. Update QIP (as author)
  console.log('\n✏️  Updating QIP-249...');
  const updatedContent = 'QIP-249: Implement Cross-Chain Bridge Support v2 - Added security considerations';
  const updatedHash = keccak256(toHex(updatedContent));
  
  const updateTx = await registry.write.updateQIP([
    249n,
    'Cross-Chain Bridge Support (Updated)',
    updatedHash,
    'ipfs://QmTest249BridgeSupportV2',
    'Added security considerations and audit requirements'
  ]);
  
  await publicClient.waitForTransactionReceipt({ hash: updateTx });
  console.log('✅ QIP-249 Updated to version 2!');

  // 8. Listen to events
  console.log('\n👂 Listening to events...');
  
  // Watch for new QIPs
  const unwatch = publicClient.watchContractEvent({
    address: REGISTRY_ADDRESS,
    abi: QIPRegistryABI,
    eventName: 'QIPCreated',
    onLogs: (logs) => {
      logs.forEach(log => {
        console.log(`\n🆕 New QIP Created:`);
        console.log(`- QIP Number: ${log.args.qipNumber}`);
        console.log(`- Title: ${log.args.title}`);
        console.log(`- Author: ${log.args.author}`);
      });
    },
  });

  // Create another QIP from different author to trigger event
  console.log('\n📝 Creating QIP from Author2...');
  const registry2 = getContract({
    address: REGISTRY_ADDRESS,
    abi: QIPRegistryABI,
    client: { public: publicClient, wallet: author2Client },
  });

  const qip250Content = 'QIP-250: Treasury Management Optimization';
  const qip250Hash = keccak256(toHex(qip250Content));
  
  await registry2.write.createQIP([
    'Treasury Management Optimization',
    'Ethereum',
    qip250Hash,
    'ipfs://QmTest250Treasury'
  ]);

  // Wait a bit for event to be logged
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Stop watching
  unwatch();

  console.log('\n✅ Local QIP Testing Complete!');
  console.log('\n📋 Summary:');
  console.log('- Created QIP-249 and QIP-250');
  console.log('- Updated QIP-249 to version 2');
  console.log('- Verified content hash');
  console.log('- Queried QIPs by author and status');
  console.log('- Demonstrated event listening');
  
  console.log('\n💡 Next steps:');
  console.log('1. Use different accounts to test permission system');
  console.log('2. Test the full QIP lifecycle (Draft → Review → Vote → Approved → Implemented)');
  console.log('3. Test migration of historical QIPs');
  console.log('4. Integrate with IPFS for real content storage');
}

// Error handling
main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});