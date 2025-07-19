#!/usr/bin/env bun

/**
 * Script to fix the QIP registry by properly migrating QIPs with correct numbering
 */

import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const QIP_REGISTRY_ADDRESS = '0xf5D5CdccEe171F02293337b7F3eda4D45B85B233' as Address;
const RPC_URL = 'http://localhost:8545';

// Create local Base fork chain
const localBaseFork = {
  ...base,
  id: 8453,
  name: 'Local Base Fork',
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] }
  }
};

async function main() {
  console.log('🔧 Checking QIP Registry state...\n');

  // Setup clients
  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({
    chain: localBaseFork,
    transport: http(RPC_URL)
  });

  const walletClient = createWalletClient({
    account,
    chain: localBaseFork,
    transport: http(RPC_URL)
  });

  console.log('📊 Checking QIP data in registry...\n');

  // Check QIPs from 209 to 248
  for (let i = 209; i <= 248; i++) {
    try {
      const qipData = await publicClient.readContract({
        address: QIP_REGISTRY_ADDRESS,
        abi: [{
          name: 'qips',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: '', type: 'uint256' }],
          outputs: [
            { name: 'qipNumber', type: 'uint256' },
            { name: 'author', type: 'address' },
            { name: 'title', type: 'string' },
            { name: 'network', type: 'string' },
            { name: 'contentHash', type: 'bytes32' },
            { name: 'ipfsUrl', type: 'string' },
            { name: 'createdAt', type: 'uint256' },
            { name: 'lastUpdated', type: 'uint256' },
            { name: 'status', type: 'uint8' },
            { name: 'implementor', type: 'string' },
            { name: 'implementationDate', type: 'uint256' },
            { name: 'snapshotProposalId', type: 'string' },
            { name: 'version', type: 'uint256' }
          ]
        }],
        functionName: 'qips',
        args: [BigInt(i)]
      });

      const [qipNumber, author, title, network, contentHash, ipfsUrl, createdAt, lastUpdated, status, implementor, implementationDate, snapshotProposalId, version] = qipData as any;
      
      if (qipNumber > 0) {
        console.log(`✅ QIP-${i}: ${title}`);
        console.log(`   Status: ${status}`);
        console.log(`   IPFS: ${ipfsUrl}\n`);
      } else {
        console.log(`❌ QIP-${i}: Not found in registry\n`);
      }
    } catch (error) {
      console.log(`❌ QIP-${i}: Error reading from registry\n`);
    }
  }

  // Check the getQIPsByStatus function for different statuses
  console.log('\n📊 Checking getQIPsByStatus function...\n');
  
  const statuses = ['Draft', 'ReviewPending', 'VotePending', 'Approved', 'Rejected', 'Implemented'];
  
  for (let i = 0; i < statuses.length; i++) {
    try {
      const qipNumbers = await publicClient.readContract({
        address: QIP_REGISTRY_ADDRESS,
        abi: [{
          name: 'getQIPsByStatus',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: '_status', type: 'uint8' }],
          outputs: [{ name: '', type: 'uint256[]' }]
        }],
        functionName: 'getQIPsByStatus',
        args: [i]
      });

      console.log(`${statuses[i]}: ${qipNumbers.length} QIPs`);
      if (qipNumbers.length > 0) {
        console.log(`   QIP Numbers: ${qipNumbers.join(', ')}`);
      }
    } catch (error) {
      console.log(`${statuses[i]}: Error reading status`);
    }
  }
}

main().catch(console.error);