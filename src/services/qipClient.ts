import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Hash, keccak256, toBytes, type Address } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { loadBalance, getRPCEndpoints } from '../utils/loadBalance';

const QIP_REGISTRY_ABI = [
  {
    inputs: [
      { name: "_title", type: "string" },
      { name: "_network", type: "string" },
      { name: "_contentHash", type: "bytes32" },
      { name: "_ipfsUrl", type: "string" }
    ],
    name: "createQIP",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
    stateMutability: "nonpayable"
  },
  {
    inputs: [
      { name: "_qipNumber", type: "uint256" },
      { name: "_title", type: "string" },
      { name: "_newContentHash", type: "bytes32" },
      { name: "_newIpfsUrl", type: "string" },
      { name: "_changeNote", type: "string" }
    ],
    name: "updateQIP",
    outputs: [],
    type: "function",
    stateMutability: "nonpayable"
  },
  {
    inputs: [
      { name: "_qipNumber", type: "uint256" },
      { name: "_snapshotProposalId", type: "string" }
    ],
    name: "linkSnapshotProposal",
    outputs: [],
    type: "function",
    stateMutability: "nonpayable"
  },
  {
    inputs: [
      { name: "_qipNumber", type: "uint256" },
      { name: "_content", type: "string" }
    ],
    name: "verifyContent",
    outputs: [{ name: "", type: "bool" }],
    type: "function",
    stateMutability: "view"
  },
  {
    inputs: [{ name: "_qipNumber", type: "uint256" }],
    name: "qips",
    outputs: [
      { name: "qipNumber", type: "uint256" },
      { name: "author", type: "address" },
      { name: "title", type: "string" },
      { name: "network", type: "string" },
      { name: "contentHash", type: "bytes32" },
      { name: "ipfsUrl", type: "string" },
      { name: "createdAt", type: "uint256" },
      { name: "lastUpdated", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "implementor", type: "string" },
      { name: "implementationDate", type: "uint256" },
      { name: "snapshotProposalId", type: "string" },
      { name: "version", type: "uint256" }
    ],
    type: "function",
    stateMutability: "view"
  },
  {
    inputs: [{ name: "_status", type: "uint8" }],
    name: "getQIPsByStatus",
    outputs: [{ name: "", type: "uint256[]" }],
    type: "function",
    stateMutability: "view"
  },
  {
    inputs: [{ name: "_author", type: "address" }],
    name: "getQIPsByAuthor",
    outputs: [{ name: "", type: "uint256[]" }],
    type: "function",
    stateMutability: "view"
  },
  {
    inputs: [
      { name: "_qipNumber", type: "uint256" },
      { name: "_newStatus", type: "uint8" }
    ],
    name: "updateStatus",
    outputs: [],
    type: "function",
    stateMutability: "nonpayable"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "qipNumber", type: "uint256" },
      { indexed: true, name: "author", type: "address" },
      { indexed: false, name: "title", type: "string" },
      { indexed: false, name: "network", type: "string" },
      { indexed: false, name: "contentHash", type: "bytes32" },
      { indexed: false, name: "ipfsUrl", type: "string" }
    ],
    name: "QIPCreated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "qipNumber", type: "uint256" },
      { indexed: false, name: "version", type: "uint256" },
      { indexed: false, name: "newContentHash", type: "bytes32" },
      { indexed: false, name: "newIpfsUrl", type: "string" },
      { indexed: false, name: "changeNote", type: "string" }
    ],
    name: "QIPUpdated",
    type: "event"
  }
] as const;

export enum QIPStatus {
  Draft = 0,
  ReviewPending = 1,
  VotePending = 2,
  Approved = 3,
  Rejected = 4,
  Implemented = 5,
  Superseded = 6,
  Withdrawn = 7
}

export interface QIPContent {
  qip: number;
  title: string;
  network: string;
  status: string;
  author: string;
  implementor: string;
  'implementation-date': string;
  proposal: string;
  created: string;
  content: string; // Full markdown content
}

export interface QIP {
  qipNumber: bigint;
  author: Address;
  title: string;
  network: string;
  contentHash: Hash;
  ipfsUrl: string;
  createdAt: bigint;
  lastUpdated: bigint;
  status: QIPStatus;
  implementor: string;
  implementationDate: bigint;
  snapshotProposalId: string;
  version: bigint;
}

export class QIPClient {
  private publicClient: PublicClient;
  private contractAddress: Address;

  constructor(
    contractAddress: Address,
    rpcUrl?: string,
    testnet: boolean = false
  ) {
    console.log("🔧 QIPClient Debug:");
    console.log("- contractAddress:", contractAddress);
    console.log("- rpcUrl:", rpcUrl);
    console.log("- testnet:", testnet);
    
    this.contractAddress = contractAddress;
    
    // For local development, use a custom chain configuration
    const chain = rpcUrl?.includes('localhost') || rpcUrl?.includes('127.0.0.1') 
      ? {
          ...base,
          id: 8453, // Base chain ID
          name: 'Local Base Fork',
          rpcUrls: {
            default: { http: [rpcUrl || 'http://localhost:8545'] },
            public: { http: [rpcUrl || 'http://localhost:8545'] }
          }
        }
      : (testnet ? baseSepolia : base);
    
    console.log("- Using chain:", chain.name, "with ID:", chain.id);
    
    // Create load balanced transport with multiple RPC endpoints
    // Always use multiple endpoints for load balancing, even if one is provided
    const rpcEndpoints = getRPCEndpoints();
    console.log(`- Using ${rpcEndpoints.length} RPC endpoints with load balancing`);
    console.log(`- RPC endpoints:`, rpcEndpoints.slice(0, 3).join(', '), '...');
    
    const transport = rpcEndpoints.length > 1
      ? loadBalance(rpcEndpoints.map(url => http(url)))
      : http(rpcEndpoints[0]);
    
    this.publicClient = createPublicClient({
      chain,
      transport,
      batch: {
        multicall: {
          batchSize: 3, // Further reduced to avoid rate limits
          wait: 50, // Increased wait time to batch requests
        },
      },
      pollingInterval: 4_000, // Poll every 4 seconds
    }) as any;
    
    console.log("- PublicClient created:", !!this.publicClient);
  }


  /**
   * Get the load-balanced public client for external use
   */
  public getPublicClient(): PublicClient {
    return this.publicClient;
  }

  /**
   * Check if running in local development
   */
  private isLocalDevelopment(): boolean {
    const transport = this.publicClient.transport;
    const url = transport.url || '';
    return url.includes('localhost') || url.includes('127.0.0.1');
  }

  /**
   * Create a new QIP
   */
  async createQIP(
    walletClient: WalletClient,
    title: string,
    network: string,
    contentHash: Hash,
    ipfsUrl: string
  ): Promise<{ hash: Hash; qipNumber: bigint }> {
    if (!walletClient?.account) throw new Error("Wallet client with account required");
    
    // First estimate gas
    const estimatedGas = await this.publicClient.estimateContractGas({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'createQIP',
      args: [title, network, contentHash, ipfsUrl],
      account: walletClient.account
    });
    
    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'createQIP',
      args: [title, network, contentHash, ipfsUrl],
      account: walletClient.account,
      gas: estimatedGas * 120n / 100n // Add 20% buffer
    });

    console.log('📝 Writing contract transaction...');
    const hash = await walletClient.writeContract(request);
    console.log('✅ Transaction submitted:', hash);
    
    // Wait for transaction and get QIP number from logs
    console.log('⏳ Waiting for transaction receipt...');
    
    // Add timeout for local development (Anvil sometimes doesn't auto-mine)
    const receipt = await this.publicClient.waitForTransactionReceipt({ 
      hash,
      timeout: 20_000, // 20 second timeout
      pollingInterval: 1_000, // Poll every second
      confirmations: 1
    }).catch(async (error) => {
      console.warn('⚠️ Receipt timeout, attempting to force mine...');
      
      // For local development, try to force mine a block
      if (this.isLocalDevelopment()) {
        try {
          // Force mine a block using Anvil's RPC method
          await fetch(this.publicClient.transport.url || 'http://localhost:8545', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'evm_mine',
              params: [],
              id: 1
            })
          });
          console.log('✅ Forced block mine');
          
          // Try again after mining
          return await this.publicClient.waitForTransactionReceipt({ 
            hash,
            timeout: 5_000,
            confirmations: 1
          });
        } catch (mineError) {
          console.error('❌ Failed to force mine:', mineError);
        }
      }
      
      throw error;
    });
    
    console.log('✅ Transaction confirmed:', receipt);
    
    if (!receipt) {
      // If we couldn't get a receipt, return a placeholder QIP number
      console.warn('⚠️ No receipt available, returning transaction hash only');
      return { hash, qipNumber: BigInt(0) };
    }
    
    const log = receipt.logs.find(log => 
      log.address.toLowerCase() === this.contractAddress.toLowerCase()
    );
    
    if (!log) {
      console.warn('⚠️ No event log found in receipt, transaction may still be pending');
      return { hash, qipNumber: BigInt(0) };
    }
    
    // Decode the QIP number from the event
    const qipNumber = BigInt(log.topics[1]!);
    console.log('✅ QIP number decoded:', qipNumber);
    
    return { hash, qipNumber };
  }

  /**
   * Update an existing QIP
   */
  async updateQIP(
    walletClient: WalletClient,
    qipNumber: bigint,
    title: string,
    newContentHash: Hash,
    newIpfsUrl: string,
    changeNote: string
  ): Promise<Hash> {
    if (!walletClient?.account) throw new Error("Wallet client with account required");
    
    // First estimate gas
    const estimatedGas = await this.publicClient.estimateContractGas({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'updateQIP',
      args: [qipNumber, title, newContentHash, newIpfsUrl, changeNote],
      account: walletClient.account
    });
    
    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'updateQIP',
      args: [qipNumber, title, newContentHash, newIpfsUrl, changeNote],
      account: walletClient.account,
      gas: estimatedGas * 120n / 100n // Add 20% buffer
    });

    return await walletClient.writeContract(request);
  }

  /**
   * Link a Snapshot proposal to a QIP
   */
  async linkSnapshotProposal(
    walletClient: WalletClient,
    qipNumber: bigint,
    snapshotProposalId: string
  ): Promise<Hash> {
    if (!walletClient?.account) throw new Error("Wallet client with account required");
    
    // First estimate gas
    const estimatedGas = await this.publicClient.estimateContractGas({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'linkSnapshotProposal',
      args: [qipNumber, snapshotProposalId],
      account: walletClient.account
    });
    
    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'linkSnapshotProposal',
      args: [qipNumber, snapshotProposalId],
      account: walletClient.account,
      gas: estimatedGas * 120n / 100n // Add 20% buffer
    });

    return await walletClient.writeContract(request);
  }

  /**
   * Calculate content hash for QIP content
   */
  calculateContentHash(content: string): Hash {
    return keccak256(toBytes(content));
  }

  /**
   * Format QIP content for hashing and storage
   */
  formatQIPContent(qipData: QIPContent): string {
    // Create YAML frontmatter
    const frontmatter = `---
qip: ${qipData.qip}
title: ${qipData.title}
network: ${qipData.network}
status: ${qipData.status}
author: ${qipData.author}
implementor: ${qipData.implementor}
implementation-date: ${qipData['implementation-date']}
proposal: ${qipData.proposal}
created: ${qipData.created}
---

${qipData.content}`;
    
    return frontmatter;
  }

  /**
   * Verify QIP content matches on-chain hash
   */
  async verifyContent(qipNumber: bigint, content: string): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'verifyContent',
      args: [qipNumber, content]
    });
    
    return result;
  }

  /**
   * Get QIP details
   */
  async getQIP(qipNumber: bigint): Promise<QIP> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'qips',
      args: [qipNumber]
    });
    
    return {
      qipNumber: result[0],
      author: result[1],
      title: result[2],
      network: result[3],
      contentHash: result[4],
      ipfsUrl: result[5],
      createdAt: result[6],
      lastUpdated: result[7],
      status: result[8] as QIPStatus,
      implementor: result[9],
      implementationDate: result[10],
      snapshotProposalId: result[11],
      version: result[12]
    };
  }

  /**
   * Get the next QIP number (highest QIP + 1)
   */
  async getNextQIPNumber(): Promise<bigint> {
    const result = await (this.publicClient as any).readContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'nextQIPNumber'
    });
    
    return result as bigint;
  }

  /**
   * Get multiple QIPs using multicall for efficiency
   */
  async getQIPsBatch(qipNumbers: bigint[]): Promise<QIP[]> {
    if (qipNumbers.length === 0) return [];

    // Limit batch size to avoid gas limits and rate limits
    const MAX_BATCH_SIZE = 3; // Reduced to avoid rate limits
    
    if (qipNumbers.length > MAX_BATCH_SIZE) {
      // Split into smaller batches if needed
      const results: QIP[] = [];
      for (let i = 0; i < qipNumbers.length; i += MAX_BATCH_SIZE) {
        const batch = qipNumbers.slice(i, Math.min(i + MAX_BATCH_SIZE, qipNumbers.length));
        
        // Add small delay between recursive calls to avoid rate limits
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        const batchResults = await this.getQIPsBatch(batch);
        results.push(...batchResults);
      }
      return results;
    }

    // Create contract calls for multicall
    const calls = qipNumbers.map(qipNumber => ({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'qips',
      args: [qipNumber]
      // gas removed - not supported in multicall parameters
    }));

    try {
      // Use multicall to batch all requests into a single RPC call
      const results = await this.publicClient.multicall({
        contracts: calls,
        allowFailure: true // Allow individual calls to fail without failing the entire batch
        // gas removed - not supported in multicall parameters
      });

      const qips: QIP[] = [];
      
      for (let i = 0; i < results.length; i++) {
        const result = results[i] as any;
        if (result.status === 'success' && result.result) {
          const data = result.result as any;
          // Only include QIPs that actually exist (qipNumber > 0)
          if (data[0] > 0n) {
            qips.push({
              qipNumber: data[0],
              author: data[1],
              title: data[2],
              network: data[3],
              contentHash: data[4],
              ipfsUrl: data[5],
              createdAt: data[6],
              lastUpdated: data[7],
              status: data[8] as QIPStatus,
              implementor: data[9],
              implementationDate: data[10],
              snapshotProposalId: data[11],
              version: data[12]
            });
          }
        }
      }

      return qips;
    } catch (error) {
      console.error('Error in multicall batch:', error);
      // Fallback to individual calls if multicall fails
      const qips: QIP[] = [];
      for (const qipNumber of qipNumbers) {
        try {
          const qip = await this.getQIP(qipNumber);
          qips.push(qip);
        } catch (e) {
          console.error(`Failed to fetch QIP ${qipNumber}:`, e);
        }
      }
      return qips;
    }
  }

  /**
   * Get all QIPs by status using multicall for efficiency
   */
  async getAllQIPsByStatusBatch(): Promise<Map<QIPStatus, bigint[]>> {
    const statuses: QIPStatus[] = [
      QIPStatus.Draft,
      QIPStatus.ReviewPending,
      QIPStatus.VotePending,
      QIPStatus.Approved,
      QIPStatus.Rejected,
      QIPStatus.Implemented,
      QIPStatus.Superseded,
      QIPStatus.Withdrawn,
    ];

    // Split status queries into smaller batches to avoid gas limits
    const BATCH_SIZE = 4; // Each getQIPsByStatus can return many items, so keep batch small
    const statusMap = new Map<QIPStatus, bigint[]>();
    
    for (let i = 0; i < statuses.length; i += BATCH_SIZE) {
      const batchStatuses = statuses.slice(i, Math.min(i + BATCH_SIZE, statuses.length));
      
      // Create calls for this batch of statuses
      const calls = batchStatuses.map(status => ({
        address: this.contractAddress,
        abi: QIP_REGISTRY_ABI,
        functionName: 'getQIPsByStatus',
        args: [status]
        // gas removed - not supported in multicall parameters
      }));

      try {
        // Batch status queries with gas limit
        const results = await this.publicClient.multicall({
          contracts: calls,
          allowFailure: true
          // gas removed - not supported in multicall parameters
        });
        
        for (let j = 0; j < results.length; j++) {
          const result = results[j] as any;
          const status = batchStatuses[j];
          
          if (result.status === 'success' && result.result) {
            statusMap.set(status, result.result as bigint[]);
          } else {
            statusMap.set(status, []);
          }
        }
      } catch (error) {
        console.error('Error in status multicall batch:', error);
        // Fallback to individual calls for this batch
        for (const status of batchStatuses) {
          try {
            const qips = await this.getQIPsByStatus(status);
            statusMap.set(status, qips);
          } catch (e) {
            statusMap.set(status, []);
          }
        }
      }
    }
    
    return statusMap;
  }

  /**
   * Get QIPs by status
   */
  async getQIPsByStatus(status: QIPStatus): Promise<bigint[]> {
    try {
      const result = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: QIP_REGISTRY_ABI,
        functionName: 'getQIPsByStatus',
        args: [status]
      });
      
      // Handle case where result is empty or null
      if (!result || (Array.isArray(result) && result.length === 0)) {
        return [];
      }
      
      return result as bigint[];
    } catch (error: any) {
      // Handle viem "no data" error which occurs when array is empty
      if (error.message?.includes('returned no data') || error.message?.includes('0x')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get QIPs by author
   */
  async getQIPsByAuthor(author: Address): Promise<bigint[]> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'getQIPsByAuthor',
      args: [author]
    });
    
    return result as bigint[];
  }

  /**
   * Watch for new QIPs
   */
  watchQIPs(callback: (qip: {
    qipNumber: bigint;
    author: Address;
    title: string;
    network: string;
    contentHash: Hash;
    ipfsUrl: string;
  }) => void) {
    return this.publicClient.watchContractEvent({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      eventName: 'QIPCreated',
      onLogs: (logs) => {
        logs.forEach(log => {
          const args = log.args as any;
          callback({
            qipNumber: BigInt(log.topics[1]!),
            author: log.topics[2] as Address,
            title: args?.title || '',
            network: args?.network || '',
            contentHash: args?.contentHash || '0x',
            ipfsUrl: args?.ipfsUrl || ''
          });
        });
      }
    });
  }

  /**
   * Get status string from enum
   */
  getStatusString(status: QIPStatus): string {
    const statusMap = {
      [QIPStatus.Draft]: 'Draft',
      [QIPStatus.ReviewPending]: 'Review',
      [QIPStatus.VotePending]: 'Vote',
      [QIPStatus.Approved]: 'Approved',
      [QIPStatus.Rejected]: 'Rejected',
      [QIPStatus.Implemented]: 'Implemented',
      [QIPStatus.Superseded]: 'Superseded',
      [QIPStatus.Withdrawn]: 'Withdrawn'
    };
    
    return statusMap[status] || 'Unknown';
  }

  /**
   * Helper method to create QIP from QIPContent
   */
  async createQIPFromContent(
    walletClient: WalletClient,
    content: QIPContent,
    ipfsUrl: string
  ): Promise<{ qipNumber: bigint; transactionHash: string }> {
    const contentHash = keccak256(toBytes(content.content));
    const result = await this.createQIP(
      walletClient,
      content.title,
      content.network,
      contentHash,
      ipfsUrl
    );
    
    return {
      qipNumber: result.qipNumber,
      transactionHash: result.hash
    };
  }

  /**
   * Helper method to update QIP from QIPContent
   */
  async updateQIPFromContent(
    walletClient: WalletClient,
    qipNumber: bigint,
    content: QIPContent,
    ipfsUrl: string
  ): Promise<{ version: bigint; transactionHash: string }> {
    const contentHash = keccak256(toBytes(content.content));
    const hash = await this.updateQIP(
      walletClient,
      qipNumber,
      content.title,
      contentHash,
      ipfsUrl,
      'Updated via QIP Editor'
    );

    // Get the updated QIP to return the new version
    const updatedQIP = await this.getQIP(qipNumber);
    
    return {
      version: updatedQIP.version,
      transactionHash: hash
    };
  }

  /**
   * Update QIP status
   */
  async updateQIPStatus(
    walletClient: WalletClient,
    qipNumber: bigint,
    newStatus: QIPStatus
  ): Promise<Hash> {
    if (!walletClient?.account) throw new Error("Wallet client with account required");
    
    // First estimate gas
    const estimatedGas = await this.publicClient.estimateContractGas({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'updateStatus',
      args: [qipNumber, newStatus],
      account: walletClient.account
    });
    
    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: QIP_REGISTRY_ABI,
      functionName: 'updateStatus',
      args: [qipNumber, newStatus],
      account: walletClient.account,
      gas: estimatedGas * 120n / 100n // Add 20% buffer
    });

    return await walletClient.writeContract(request);
  }
}