#!/usr/bin/env bun

/**
 * LOCAL DEVELOPMENT ONLY - Migration script to upload existing QIPs to local IPFS
 * 
 * This script is for local development environments only. It:
 * - Reads QIPs from the local filesystem
 * - Uploads them to a local IPFS daemon (localhost:5001)
 * - Updates the local Anvil blockchain registry with the new IPFS CIDs
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
      // Update blockchain registry
      console.log(`📝 Updating blockchain registry for QIP-${qipNumber}...`);
      
      // Check if QIP already exists
      let existingQIP: any;
      try {
        existingQIP = await qipClient.getQIP(BigInt(qipNumber));
      } catch (error) {
        // QIP doesn't exist yet, which is fine
        existingQIP = null;
      }
      
      if (existingQIP && existingQIP.ipfsUrl && existingQIP.ipfsUrl !== '') {
        console.log(`⚠️  QIP-${qipNumber} already exists with IPFS URL: ${existingQIP.ipfsUrl}`);
        
        // Update the QIP with new IPFS URL
        const hash = await qipClient.updateQIP(
          BigInt(qipNumber),
          parsed.frontmatter.title,
          contentHash,
          ipfsUrl,
          'Migration to local IPFS'
        );
        
        console.log(`🔄 Updated QIP-${qipNumber} in blockchain: ${hash}`);
      } else {
        // Create new QIP
        try {
          const { hash, qipNumber: newQipNumber } = await qipClient.createQIP(
            parsed.frontmatter.title,
            parsed.frontmatter.network || 'Polygon',
            contentHash,
            ipfsUrl
          );
          
          console.log(`🆕 Created QIP-${qipNumber} (assigned blockchain ID: ${newQipNumber}) in blockchain: ${hash}`);
        } catch (createError: any) {
          if (createError.message?.includes('Content already exists')) {
            console.log(`⚠️  QIP-${qipNumber}: Content already exists on blockchain (likely from a previous migration)`);
            // This is not a failure - the content is already on-chain
            return { success: true, cid };
          }
          throw createError;
        }
      }
    }
    
    return { success: true, cid };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Failed to migrate QIP-${qipNumber}:`, errorMessage);
    return { success: false, error: errorMessage };
  }
}

async function main() {
  console.log('🚀 Starting QIP migration to local IPFS...\n');
  
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
  // In development, we can use the first Anvil account
  if (!CONFIG.dryRun) {
    console.log('🔑 Setting up wallet client for blockchain transactions...');
    
    // Use the first Anvil account (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266)
    const privateKey = process.env.PRIVATE_KEY as `0x${string}` || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    try {
      // Create wallet client using viem
      const { createWalletClient, http } = await import('viem');
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
  
  // Check which QIPs already exist on blockchain
  console.log('🔍 Checking existing QIPs on blockchain...');
  const existingQIPs = new Set<number>();
  for (const file of qipFiles) {
    const qipNumber = extractQIPNumber(file);
    if (qipNumber) {
      try {
        const qip = await qipClient.getQIP(BigInt(qipNumber));
        if (qip && qip.ipfsUrl && qip.ipfsUrl !== '') {
          existingQIPs.add(qipNumber);
        }
      } catch (error) {
        // QIP doesn't exist, which is fine
      }
    }
  }
  
  if (existingQIPs.size > 0) {
    console.log(`⚠️  Found ${existingQIPs.size} QIPs already on blockchain: ${Array.from(existingQIPs).join(', ')}\n`);
  }
  
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