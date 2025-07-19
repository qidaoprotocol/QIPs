#!/usr/bin/env bun

/**
 * LOCAL DEVELOPMENT ONLY - Migration script to upload existing QIPs with original numbers
 * 
 * This script is for local development environments only. It:
 * - Uses the migrateQIP function to preserve original QIP numbers (209-248)
 * - Uploads QIPs to local IPFS daemon (localhost:5001)
 * - Registers them on local Anvil blockchain with their original numbers
 * 
 * DO NOT use this script in production!
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { IPFSService, LocalIPFSProvider } from '../src/services/ipfsService';
import { QIPClient } from '../src/services/qipClient';
import { Address } from 'viem';

interface MigrationConfig {
  qipDir: string;
  registryAddress: Address;
  rpcUrl: string;
  localIPFSApi: string;
  localIPFSGateway: string;
  dryRun: boolean;
}

const CONFIG: MigrationConfig = {
  qipDir: './contents/QIP',
  registryAddress: process.env.GATSBY_QIP_REGISTRY_ADDRESS as Address || '0xf5D5CdccEe171F02293337b7F3eda4D45B85B233',
  rpcUrl: process.env.GATSBY_BASE_RPC_URL || 'http://localhost:8545',
  localIPFSApi: process.env.GATSBY_LOCAL_IPFS_API || 'http://localhost:5001',
  localIPFSGateway: process.env.GATSBY_LOCAL_IPFS_GATEWAY || 'http://localhost:8080',
  dryRun: process.argv.includes('--dry-run'),
};

console.log('🔧 Migration Configuration:');
console.log('- QIP Directory:', CONFIG.qipDir);
console.log('- Registry Address:', CONFIG.registryAddress);
console.log('- RPC URL:', CONFIG.rpcUrl);
console.log('- Local IPFS API:', CONFIG.localIPFSApi);
console.log('- Local IPFS Gateway:', CONFIG.localIPFSGateway);
console.log('- Dry Run:', CONFIG.dryRun);
console.log('');

async function checkIPFSHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${CONFIG.localIPFSApi}/api/v0/version`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ IPFS daemon is running:', data.Version);
      return true;
    }
  } catch (error) {
    console.error('❌ IPFS daemon not accessible:', error);
  }
  return false;
}

function extractQIPNumber(filename: string): number | null {
  const match = filename.match(/QIP-(\d+)\.md/);
  return match ? parseInt(match[1]) : null;
}

function parseQIPContent(content: string): any {
  const frontmatterMatch = content.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  
  if (!frontmatterMatch) {
    throw new Error('Invalid QIP format: missing frontmatter');
  }
  
  const yamlContent = frontmatterMatch[1];
  const markdownContent = frontmatterMatch[2].trim();
  
  // Parse YAML frontmatter
  const frontmatter: Record<string, any> = {};
  const lines = yamlContent.split('\n');
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value === 'None' ? null : value;
    }
  }
  
  return {
    frontmatter,
    content: markdownContent,
    fullContent: content
  };
}

// Map status strings to enum values
function mapStatus(status: string): number {
  const statusMap: Record<string, number> = {
    'Draft': 0,
    'Review': 1,
    'ReviewPending': 1,
    'Vote': 2,
    'VotePending': 2,
    'Approved': 3,
    'Rejected': 4,
    'Implemented': 5,
    'Superseded': 6,
    'Withdrawn': 7
  };
  return statusMap[status] || 0;
}

async function migrateQIP(
  qipNumber: number,
  filePath: string,
  ipfsService: IPFSService,
  qipClient: QIPClient
): Promise<{ success: boolean; cid?: string; error?: string }> {
  try {
    console.log(`📄 Processing QIP-${qipNumber}...`);
    
    // Read QIP content
    const content = readFileSync(filePath, 'utf-8');
    const parsed = parseQIPContent(content);
    
    // Upload to IPFS
    console.log(`📤 Uploading QIP-${qipNumber} to IPFS...`);
    const { cid, ipfsUrl, contentHash } = await ipfsService.uploadRawContent(parsed.fullContent);
    
    console.log(`✅ Uploaded QIP-${qipNumber} to IPFS:`);
    console.log(`   CID: ${cid}`);
    console.log(`   URL: ${ipfsUrl}`);
    console.log(`   Hash: ${contentHash}`);
    
    if (!CONFIG.dryRun) {
      // Check if QIP already exists
      let existingQIP: any;
      try {
        existingQIP = await qipClient.getQIP(BigInt(qipNumber));
      } catch (error) {
        // QIP doesn't exist yet, which is fine
        existingQIP = null;
      }
      
      if (existingQIP && existingQIP.qipNumber > 0) {
        console.log(`⚠️  QIP-${qipNumber} already exists on blockchain`);
        return { success: true, cid };
      }
      
      // Use migrateQIP function to preserve original number
      console.log(`📝 Migrating QIP-${qipNumber} to blockchain with original number...`);
      
      // Parse dates
      const createdDate = new Date(parsed.frontmatter.created || '2024-01-01');
      
      // Parse implementation date - handle non-date strings
      let implementationDate = 0;
      if (parsed.frontmatter['implementation-date'] && 
          parsed.frontmatter['implementation-date'] !== 'None') {
        const implDateStr = parsed.frontmatter['implementation-date'];
        // Check if it's a valid date format (YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}$/.test(implDateStr)) {
          try {
            implementationDate = Math.floor(new Date(implDateStr).getTime() / 1000);
          } catch (e) {
            // Invalid date, keep as 0
          }
        }
        // Otherwise keep as 0 for non-date strings like "immediately after approval"
      }
      
      // Get the contract ABI for migrateQIP function
      const abi = [
        {
          "inputs": [
            {"name": "_qipNumber", "type": "uint256"},
            {"name": "_author", "type": "address"},
            {"name": "_title", "type": "string"},
            {"name": "_network", "type": "string"},
            {"name": "_contentHash", "type": "bytes32"},
            {"name": "_ipfsUrl", "type": "string"},
            {"name": "_createdAt", "type": "uint256"},
            {"name": "_status", "type": "uint8"},
            {"name": "_implementor", "type": "string"},
            {"name": "_implementationDate", "type": "uint256"},
            {"name": "_snapshotProposalId", "type": "string"}
          ],
          "name": "migrateQIP",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        }
      ];
      
      // Use a default author address for migration
      const authorAddress = '0x0000000000000000000000000000000000000001' as Address;
      
      // Get wallet client from qipClient
      const walletClient = (qipClient as any).walletClient;
      if (!walletClient) {
        throw new Error('Wallet client not initialized');
      }
      
      const hash = await walletClient.writeContract({
        address: CONFIG.registryAddress,
        abi,
        functionName: 'migrateQIP',
        args: [
          BigInt(qipNumber),
          authorAddress,
          parsed.frontmatter.title || '',
          parsed.frontmatter.network || 'Polygon',
          contentHash,
          ipfsUrl,
          BigInt(Math.floor(createdDate.getTime() / 1000)),
          mapStatus(parsed.frontmatter.status || 'Draft'),
          parsed.frontmatter.implementor || 'None',
          BigInt(implementationDate),
          parsed.frontmatter.proposal || ''
        ]
      });
      
      console.log(`🆕 Migrated QIP-${qipNumber} to blockchain: ${hash}`);
    }
    
    return { success: true, cid };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Failed to migrate QIP-${qipNumber}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

async function main() {
  console.log('🚀 Starting QIP migration with original numbers...\n');
  
  // Check if IPFS is running
  const ipfsHealthy = await checkIPFSHealth();
  if (!ipfsHealthy) {
    console.error('❌ IPFS daemon is not running. Please start it first:');
    console.error('   ipfs daemon &');
    console.error('   or');
    console.error('   bun run dev:local');
    process.exit(1);
  }
  
  // Check if QIP directory exists
  if (!existsSync(CONFIG.qipDir)) {
    console.error('❌ QIP directory not found:', CONFIG.qipDir);
    process.exit(1);
  }
  
  // Initialize services
  const ipfsService = new IPFSService(new LocalIPFSProvider(
    CONFIG.localIPFSApi,
    CONFIG.localIPFSGateway
  ));
  
  const qipClient = new QIPClient(
    CONFIG.registryAddress,
    CONFIG.rpcUrl,
    false // testnet
  );
  
  // For blockchain transactions, we need to set up a wallet client
  if (!CONFIG.dryRun) {
    console.log('🔑 Setting up wallet client for blockchain transactions...');
    
    // Use the first Anvil account (Governance/Deployer: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
    // This account is the deployer and has editor permissions by default
    const privateKey = process.env.PRIVATE_KEY as `0x${string}` || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
      try {
        // Create wallet client using viem
        const { createWalletClient, createPublicClient, http } = await import('viem');
        const { privateKeyToAccount } = await import('viem/accounts');
        const { base } = await import('viem/chains');      
      const account = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({
        account,
        chain: base,
        transport: http(CONFIG.rpcUrl)
      });
      
      qipClient.setWalletClient(walletClient);
      console.log('✅ Wallet client connected with address:', account.address);
      
      // Check if the account has editor role
      try {
        const publicClient = createPublicClient({
          chain: base,
          transport: http(CONFIG.rpcUrl)
        });
        
        const isEditor = await publicClient.readContract({
          address: CONFIG.registryAddress,
          abi: [{
            "inputs": [{"name": "", "type": "address"}],
            "name": "editors",
            "outputs": [{"name": "", "type": "bool"}],
            "stateMutability": "view",
            "type": "function"
          }],
          functionName: 'editors',
          args: [account.address]
        });
        
        console.log('🔐 Editor role check:', isEditor ? 'YES' : 'NO');
        
        if (!isEditor) {
          console.error('❌ Account does not have editor role!');
          console.log('💡 Make sure LocalQIPTest script has run to grant editor role');
          process.exit(1);
        }
      } catch (error) {
        console.error('❌ Failed to check editor role:', error);
      }
    } catch (error) {
      console.error('❌ Failed to connect wallet:', error);
      console.log('💡 Make sure Anvil is running with: bun run dev:local');
      process.exit(1);
    }
  }
  
  // Get all QIP files
  const files = readdirSync(CONFIG.qipDir);
  const qipFiles = files
    .filter(f => f.startsWith('QIP-') && f.endsWith('.md'))
    .sort((a, b) => {
      const numA = extractQIPNumber(a) || 0;
      const numB = extractQIPNumber(b) || 0;
      return numA - numB;
    });
  
  console.log(`📁 Found ${qipFiles.length} QIP files to migrate\n`);
  
  if (CONFIG.dryRun) {
    console.log('🔍 Running in DRY RUN mode - no blockchain transactions will be made\n');
  }
  
  // Migrate each QIP
  const results: Array<{ qipNumber: number; success: boolean; cid?: string; error?: string }> = [];
  for (const file of qipFiles) {
    const qipNumber = extractQIPNumber(file);
    if (qipNumber) {
      const filePath = join(CONFIG.qipDir, file);
      const result = await migrateQIP(qipNumber, filePath, ipfsService, qipClient);
      results.push({ qipNumber, ...result });
    }
  }
  
  // Summary
  console.log('\n📊 Migration Summary:');
  console.log('===================');
  console.log(`Total QIPs processed: ${results.length}`);
  console.log(`Successful: ${results.filter(r => r.success).length}`);
  console.log(`Failed: ${results.filter(r => !r.success).length}`);
  
  const successful = results.filter(r => r.success);
  if (successful.length > 0) {
    console.log('\n✅ Successfully migrated QIPs:');
    successful.forEach(r => {
      console.log(`   QIP-${r.qipNumber}: ${r.cid}`);
    });
  }
  
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.log('\n❌ Failed QIPs:');
    failed.forEach(r => {
      console.log(`   QIP-${r.qipNumber}: ${r.error}`);
    });
  }
  
  console.log('\n🎉 Migration complete!');
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the migration
main().catch(error => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});