#!/usr/bin/env bun

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { QIPClient, QIPStatus } from '../src/services/qipClient';
import { IPFSService, PinataProvider } from '../src/services/ipfsService';

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const QIP_REGISTRY_ADDRESS = process.env.QIP_REGISTRY_ADDRESS as Address;
const PINATA_JWT = process.env.PINATA_JWT || '';
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud';
const USE_TESTNET = process.env.USE_TESTNET === 'true';
const RPC_URL = process.env.BASE_RPC_URL;

// Paths
const QIP_DIR = join(process.cwd(), 'contents/QIP');

interface QIPFrontmatter {
  qip: number;
  title: string;
  network: string;
  status: string;
  author: string;
  implementor: string;
  'implementation-date': string;
  proposal: string;
  created: string;
}

async function parseQIPFile(filePath: string): Promise<{ frontmatter: QIPFrontmatter; content: string }> {
  const fileContent = await readFile(filePath, 'utf-8');
  const match = fileContent.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  
  if (!match) {
    throw new Error(`Invalid QIP format in ${filePath}`);
  }
  
  const yamlContent = match[1];
  const content = match[2].trim();
  
  // Parse YAML frontmatter
  const frontmatter: any = {};
  const lines = yamlContent.split('\n');
  
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }
  
  // Convert qip to number
  if (frontmatter.qip) {
    frontmatter.qip = parseInt(frontmatter.qip);
  }
  
  return { frontmatter, content };
}

function getStatusEnum(statusString: string): QIPStatus {
  const statusMap: Record<string, QIPStatus> = {
    'Draft': QIPStatus.Draft,
    'Review': QIPStatus.ReviewPending,
    'Review Pending': QIPStatus.ReviewPending,
    'Vote': QIPStatus.VotePending,
    'Vote Pending': QIPStatus.VotePending,
    'Approved': QIPStatus.Approved,
    'Rejected': QIPStatus.Rejected,
    'Implemented': QIPStatus.Implemented,
    'Superseded': QIPStatus.Superseded,
    'Withdrawn': QIPStatus.Withdrawn
  };
  
  return statusMap[statusString] || QIPStatus.Draft;
}

async function migrateQIPs() {
  console.log('🚀 Starting QIP migration to blockchain...\n');
  
  // Validate configuration
  if (!PRIVATE_KEY || !QIP_REGISTRY_ADDRESS) {
    console.error('❌ Missing required environment variables:');
    console.error('   PRIVATE_KEY, QIP_REGISTRY_ADDRESS');
    process.exit(1);
  }
  
  if (!PINATA_JWT) {
    console.error('❌ Missing IPFS provider credentials:');
    console.error('   Please set PINATA_JWT environment variable');
    process.exit(1);
  }
  
  // Setup blockchain clients
  const chain = USE_TESTNET ? baseSepolia : base;
  const account = privateKeyToAccount(PRIVATE_KEY);
  
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL)
  });
  
  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL)
  });
  
  // Initialize services
  const qipClient = new QIPClient(QIP_REGISTRY_ADDRESS, RPC_URL, USE_TESTNET);
  qipClient.setWalletClient(walletClient);
  
  const ipfsProvider = new PinataProvider(PINATA_JWT, PINATA_GATEWAY);
  const ipfsService = new IPFSService(ipfsProvider);
  
  console.log(`📋 Registry Address: ${QIP_REGISTRY_ADDRESS}`);
  console.log(`🔗 Network: ${chain.name}`);
  console.log(`👤 Migration Account: ${account.address}`);
  console.log(`📁 IPFS Provider: Pinata\n`);
  
  // Get all QIP files
  const files = await readdir(QIP_DIR);
  const qipFiles = files.filter(f => f.startsWith('QIP-') && f.endsWith('.md'));
  
  console.log(`Found ${qipFiles.length} QIP files to migrate\n`);
  
  // Sort by QIP number
  qipFiles.sort((a, b) => {
    const numA = parseInt(a.match(/QIP-(\d+)/)?.[1] || '0');
    const numB = parseInt(b.match(/QIP-(\d+)/)?.[1] || '0');
    return numA - numB;
  });
  
  // Migration results
  const results = {
    success: [] as number[],
    failed: [] as { qip: number; error: string }[],
    skipped: [] as number[]
  };
  
  // Process each QIP
  for (const file of qipFiles) {
    const filePath = join(QIP_DIR, file);
    
    try {
      const { frontmatter, content } = await parseQIPFile(filePath);
      console.log(`\n📄 Processing QIP-${frontmatter.qip}: ${frontmatter.title}`);
      
      // Check if already migrated
      try {
        const existing = await qipClient.getQIP(BigInt(frontmatter.qip));
        if (existing.qipNumber > 0n) {
          console.log(`   ⏭️  Already migrated, skipping...`);
          results.skipped.push(frontmatter.qip);
          continue;
        }
      } catch {
        // QIP doesn't exist on-chain, proceed with migration
      }
      
      // Format full content
      const fullContent = `---
qip: ${frontmatter.qip}
title: ${frontmatter.title}
network: ${frontmatter.network}
status: ${frontmatter.status}
author: ${frontmatter.author}
implementor: ${frontmatter.implementor}
implementation-date: ${frontmatter['implementation-date']}
proposal: ${frontmatter.proposal}
created: ${frontmatter.created}
---

${content}`;
      
      // Upload to IPFS
      console.log('   📤 Uploading to IPFS...');
      const { cid, ipfsUrl, contentHash } = await ipfsService.uploadRawContent(fullContent);
      console.log(`   ✅ IPFS CID: ${cid}`);
      
      // Convert dates
      const createdTimestamp = new Date(frontmatter.created).getTime() / 1000;
      const implTimestamp = frontmatter['implementation-date'] !== 'None' 
        ? new Date(frontmatter['implementation-date']).getTime() / 1000 
        : 0;
      
      // Prepare author address (use a placeholder if it's a username)
      const authorAddress = frontmatter.author.startsWith('0x') 
        ? frontmatter.author as Address
        : '0x0000000000000000000000000000000000000001' as Address; // Placeholder
      
      // Call migrateQIP function
      console.log('   🔗 Submitting to blockchain...');
      const tx = await walletClient.writeContract({
        address: QIP_REGISTRY_ADDRESS,
        abi: [{
          inputs: [
            { name: "_qipNumber", type: "uint256" },
            { name: "_author", type: "address" },
            { name: "_title", type: "string" },
            { name: "_network", type: "string" },
            { name: "_contentHash", type: "bytes32" },
            { name: "_ipfsUrl", type: "string" },
            { name: "_createdAt", type: "uint256" },
            { name: "_status", type: "uint8" },
            { name: "_implementor", type: "string" },
            { name: "_implementationDate", type: "uint256" },
            { name: "_snapshotProposalId", type: "string" }
          ],
          name: "migrateQIP",
          outputs: [],
          type: "function"
        }],
        functionName: 'migrateQIP',
        args: [
          BigInt(frontmatter.qip),
          authorAddress,
          frontmatter.title,
          frontmatter.network,
          contentHash,
          ipfsUrl,
          BigInt(Math.floor(createdTimestamp)),
          getStatusEnum(frontmatter.status),
          frontmatter.implementor,
          BigInt(Math.floor(implTimestamp)),
          frontmatter.proposal || ''
        ]
      });
      
      console.log(`   ⏳ Waiting for transaction: ${tx}`);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      console.log(`   ✅ QIP-${frontmatter.qip} migrated successfully!`);
      
      results.success.push(frontmatter.qip);
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error: any) {
      console.error(`   ❌ Failed to migrate QIP from ${file}:`, error.message);
      const qipNum = parseInt(file.match(/QIP-(\d+)/)?.[1] || '0');
      results.failed.push({ qip: qipNum, error: error.message });
    }
  }
  
  // Summary
  console.log('\n\n📊 Migration Summary:');
  console.log(`✅ Successfully migrated: ${results.success.length}`);
  console.log(`⏭️  Skipped (already migrated): ${results.skipped.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  
  if (results.failed.length > 0) {
    console.log('\n❌ Failed QIPs:');
    results.failed.forEach(f => {
      console.log(`   - QIP-${f.qip}: ${f.error}`);
    });
  }
  
  console.log('\n🎉 Migration complete!');
}

// Run migration
migrateQIPs().catch(console.error);