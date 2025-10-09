import { createPublicClient, http, type PublicClient, type WalletClient, type Hash, keccak256, toBytes, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";
import { loadBalance, getRPCEndpoints } from "../utils/loadBalance";
import { QCIRegistryABI } from "../config/abis/QCIRegistry";
import {
  QCIStatus,
  STATUS_ENUM_TO_NAME,
  getStatusByHash,
  getStatusName as getStatusNameHelper,
  ALL_STATUS_HASHES,
  ALL_STATUS_NAMES,
} from "../config/statusConfig";

// Use the full ABI from the JSON file
const QCI_REGISTRY_ABI = QCIRegistryABI;

// Re-export QCIStatus from centralized config
export { QCIStatus } from "../config/statusConfig";

// Default status IDs (for backward compatibility)
export const DEFAULT_STATUSES = {
  Draft: QCIStatus.Draft,
  ReadyForSnapshot: QCIStatus.ReadyForSnapshot,
  PostedToSnapshot: QCIStatus.PostedToSnapshot,
  Archived: QCIStatus.Archived,
} as const;

export interface QCIContent {
  qci: number;
  title: string;
  chain: string;
  status: string;
  author: string;
  implementor: string;
  "implementation-date": string;
  proposal: string;
  created: string;
  content: string; // Full markdown content
  transactions?: string | string[]; // Optional transaction string (new) or array (legacy support)
}

export interface QCI {
  qciNumber: bigint;
  author: Address;
  title: string;
  chain: string;
  contentHash: Hash;
  ipfsUrl: string;
  createdAt: bigint;
  lastUpdated: bigint;
  status: QCIStatus;
  implementor: string;
  implementationDate: bigint;
  snapshotProposalId: string;
  version: bigint;
}

export interface QCIVersion {
  contentHash: Hash;
  ipfsUrl: string;
  timestamp: bigint;
  changeNote: string;
}

export interface QCIExportData {
  qciNumber: bigint;
  author: Address;
  title: string;
  chain: string;
  contentHash: Hash;
  ipfsUrl: string;
  createdAt: bigint;
  lastUpdated: bigint;
  statusName: string;
  implementor: string;
  implementationDate: bigint;
  snapshotProposalId: string;
  version: bigint;
  versions: readonly QCIVersion[];
  totalVersions: bigint;
}

export class QCIClient {
  private publicClient: PublicClient;
  private contractAddress: Address;
  private statusNamesCache: Map<number, string> | null = null;

  constructor(contractAddress: Address, rpcUrl?: string, testnet: boolean = false) {
    this.contractAddress = contractAddress;

    // For local development, use a custom chain configuration
    const chain =
      rpcUrl?.includes("localhost") || rpcUrl?.includes("127.0.0.1")
        ? {
            ...base,
            id: 8453, // Base chain ID
            name: "Local Base Fork",
            rpcUrls: {
              default: { http: [rpcUrl || "http://localhost:8545"] },
              public: { http: [rpcUrl || "http://localhost:8545"] },
            },
          }
        : testnet
        ? baseSepolia
        : base;

    // Create load balanced transport with multiple RPC endpoints
    // Always use multiple endpoints for load balancing, even if one is provided
    const rpcEndpoints = getRPCEndpoints();
    const transport = rpcEndpoints.length > 1 ? loadBalance(rpcEndpoints.map((url) => http(url))) : http(rpcEndpoints[0]);

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
    const url = transport.url || "";
    return url.includes("localhost") || url.includes("127.0.0.1");
  }

  /**
   * Create a new QCI
   */
  async createQCI(
    walletClient: WalletClient,
    title: string,
    chain: string,
    contentHash: Hash,
    ipfsUrl: string
  ): Promise<{ hash: Hash; qciNumber: bigint }> {
    if (!walletClient?.account) throw new Error("Wallet client with account required");

    // First estimate gas
    const estimatedGas = await this.publicClient.estimateContractGas({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "createQCI",
      args: [title, chain, contentHash, ipfsUrl],
      account: walletClient.account,
    });

    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "createQCI",
      args: [title, chain, contentHash, ipfsUrl],
      account: walletClient.account,
      gas: (estimatedGas * 120n) / 100n, // Add 20% buffer
    });

    const hash = await walletClient.writeContract(request);

    // Add timeout for local development (Anvil sometimes doesn't auto-mine)
    const receipt = await this.publicClient
      .waitForTransactionReceipt({
        hash,
        timeout: 20_000, // 20 second timeout
        pollingInterval: 1_000, // Poll every second
        confirmations: 1,
      })
      .catch(async (error) => {
        // For local development, try to force mine a block
        if (this.isLocalDevelopment()) {
          try {
            // Force mine a block using Anvil's RPC method
            await fetch(this.publicClient.transport.url || "http://localhost:8545", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                method: "evm_mine",
                params: [],
                id: 1,
              }),
            });

            // Try again after mining
            return await this.publicClient.waitForTransactionReceipt({
              hash,
              timeout: 5_000,
              confirmations: 1,
            });
          } catch (mineError) {
            console.error("Failed to force mine:", mineError);
          }
        }

        throw error;
      });

    if (!receipt) {
      // If we couldn't get a receipt, return a placeholder QCI number
      console.warn("No receipt available, returning transaction hash only");
      return { hash, qciNumber: BigInt(0) };
    }

    const log = receipt.logs.find((log) => log.address.toLowerCase() === this.contractAddress.toLowerCase());

    if (!log) {
      console.warn("No event log found in receipt, transaction may still be pending");
      return { hash, qciNumber: BigInt(0) };
    }

    // Decode the QCI number from the event
    const qciNumber = BigInt(log.topics[1]!);

    return { hash, qciNumber };
  }

  /**
   * Update an existing QCI
   */
  async updateQCI({
    walletClient,
    qciNumber,
    title,
    chain,
    implementor,
    newContentHash,
    newIpfsUrl,
    changeNote,
  }: {
    walletClient: WalletClient;
    qciNumber: bigint;
    title: string;
    chain: string;
    implementor: string;
    newContentHash: Hash;
    newIpfsUrl: string;
    changeNote: string;
  }): Promise<Hash> {
    if (!walletClient?.account) {
      throw new Error("Wallet client with account required");
    }

    // First estimate gas
    let estimatedGas;
    try {
      estimatedGas = await this.publicClient.estimateContractGas({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "updateQCI",
        args: [qciNumber, title, chain, implementor, newContentHash, newIpfsUrl, changeNote],
        account: walletClient.account,
      });
    } catch (gasError) {
      console.error("Gas estimation failed:", gasError);
      if (gasError instanceof Error) {
        const errorStr = gasError.message.toLowerCase();
        if (errorStr.includes("revert")) {
          console.error("Transaction would revert");
        }
        if (errorStr.includes("insufficient funds")) {
          console.error("Insufficient funds for gas");
        }
      }
      throw gasError;
    }

    let request;
    try {
      const simulation = await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "updateQCI",
        args: [qciNumber, title, chain, implementor, newContentHash, newIpfsUrl, changeNote],
        account: walletClient.account,
        gas: (estimatedGas * 120n) / 100n, // Add 20% buffer
      });
      request = simulation.request;
    } catch (simError) {
      console.error("Contract simulation failed:", simError);
      throw simError;
    }

    try {
      const hash = await walletClient.writeContract(request);
      return hash;
    } catch (writeError) {
      console.error("Write contract failed:", writeError);
      throw writeError;
    }
  }

  /**
   * Link a Snapshot proposal to a QCI
   */
  async linkSnapshotProposal(walletClient: WalletClient, qciNumber: bigint, snapshotProposalId: string): Promise<Hash> {
    if (!walletClient?.account) throw new Error("Wallet client with account required");

    // First estimate gas
    const estimatedGas = await this.publicClient.estimateContractGas({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "linkSnapshotProposal",
      args: [qciNumber, snapshotProposalId],
      account: walletClient.account,
    });

    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "linkSnapshotProposal",
      args: [qciNumber, snapshotProposalId],
      account: walletClient.account,
      gas: (estimatedGas * 120n) / 100n, // Add 20% buffer
    });

    return await walletClient.writeContract(request);
  }

  /**
   * Calculate content hash for QCI content
   */
  calculateContentHash(content: string): Hash {
    return keccak256(toBytes(content));
  }

  /**
   * Format QCI content for hashing and storage
   */
  formatQCIContent(qciData: QCIContent): string {
    // Create YAML frontmatter
    let frontmatter = `---
qci: ${qciData.qci}
title: ${qciData.title}
chain: ${qciData.chain}
status: ${qciData.status}
author: ${qciData.author}
implementor: ${qciData.implementor}
implementation-date: ${qciData["implementation-date"]}
proposal: ${qciData.proposal}
created: ${qciData.created}
---

${qciData.content}`;

    // Append transactions if they exist
    if (qciData.transactions) {
      frontmatter += "\n\n## Transactions\n\n";
      frontmatter += "```json\n";

      // Handle both string (new) and string[] (old) formats
      if (typeof qciData.transactions === 'string') {
        // New format: direct string containing JSON
        try {
          const parsed = JSON.parse(qciData.transactions);
          frontmatter += JSON.stringify(parsed, null, 2);
        } catch (error) {
          console.error('[qciClient] Failed to parse transaction string:', error);
          frontmatter += '[]';
        }
      } else if (Array.isArray(qciData.transactions) && qciData.transactions.length > 0) {
        // Old format: string array
        // Convert all transactions to proper JSON format
        const jsonTransactions = qciData.transactions
          .map((tx: any) => {
            if (typeof tx === "string") {
              // Try to parse if it's already JSON
              try {
                return JSON.parse(tx);
              } catch {
                // Legacy format or plain string, skip for now
                return null;
              }
            } else if (typeof tx === "object") {
              return tx;
            }
            return null;
          })
          .filter((tx: any) => tx !== null);

        // Format as JSON array
        frontmatter += JSON.stringify(jsonTransactions, null, 2);
      } else {
        // Empty or invalid
        frontmatter += '[]';
      }

      frontmatter += "\n```\n";
    }

    return frontmatter;
  }

  /**
   * Verify QCI content matches on-chain hash
   */
  async verifyContent(qciNumber: bigint, content: string): Promise<boolean> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "verifyContent",
      args: [qciNumber, content],
    });

    return result;
  }

  /**
   * Get QCI details
   */
  async getQCI(qciNumber: bigint): Promise<QCI> {
    const result = (await this.publicClient.readContract({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "qcis",
      args: [qciNumber],
    })) as any;

    // Status may come as bytes32 hash or uint8 depending on contract version
    const statusValue = result[8];

    // Convert status to enum
    let status: QCIStatus;
    if (typeof statusValue === "string" && statusValue.startsWith("0x")) {
      // It's a bytes32 hash, convert to enum
      status = this.convertStatusHashToEnum(statusValue);
    } else if (typeof statusValue === "number") {
      // It's already a number
      status = statusValue as QCIStatus;
    } else {
      // Fallback to Draft
      console.warn(`Unknown status format for QCI ${qciNumber}:`, statusValue);
      status = QCIStatus.Draft;
    }

    return {
      qciNumber: result[0],
      author: result[1],
      title: result[2],
      chain: result[3],
      contentHash: result[4],
      ipfsUrl: result[5],
      createdAt: result[6],
      lastUpdated: result[7],
      status: status,
      implementor: result[9],
      implementationDate: result[10],
      snapshotProposalId: result[11],
      version: result[12],
    };
  }

  /**
   * Get the next QCI number (highest QCI + 1)
   */
  async getNextQCINumber(): Promise<bigint> {
    const result = await (this.publicClient as any).readContract({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "nextQCINumber",
    });

    return result as bigint;
  }

  /**
   * Get multiple QCIs using multicall for efficiency
   */
  async getQCIsBatch(qciNumbers: bigint[]): Promise<QCI[]> {
    if (qciNumbers.length === 0) return [];

    // Limit batch size to avoid gas limits and rate limits
    const MAX_BATCH_SIZE = 3; // Reduced to avoid rate limits

    if (qciNumbers.length > MAX_BATCH_SIZE) {
      // Split into smaller batches if needed
      const results: QCI[] = [];
      for (let i = 0; i < qciNumbers.length; i += MAX_BATCH_SIZE) {
        const batch = qciNumbers.slice(i, Math.min(i + MAX_BATCH_SIZE, qciNumbers.length));

        // Add small delay between recursive calls to avoid rate limits
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const batchResults = await this.getQCIsBatch(batch);
        results.push(...batchResults);
      }
      return results;
    }

    // Create contract calls for multicall
    const calls = qciNumbers.map((qciNumber) => ({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "qcis",
      args: [qciNumber],
      // gas removed - not supported in multicall parameters
    }));

    try {
      // Use multicall to batch all requests into a single RPC call
      const results = await this.publicClient.multicall({
        contracts: calls,
        allowFailure: true, // Allow individual calls to fail without failing the entire batch
        // gas removed - not supported in multicall parameters
      });

      const qcis: QCI[] = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i] as any;
        if (result.status === "success" && result.result) {
          const data = result.result as any;
          // Only include QCIs that actually exist (qciNumber > 0)
          if (data[0] > 0n) {
            // The contract is actually returning bytes32 hash for status, not uint8!
            let status: QCIStatus;

            // data[8] could be a bigint, string, or already converted to number
            // We need to handle the bytes32 hash properly
            let statusValue = data[8];

            // If it's already a bigint, convert to hex
            if (typeof statusValue === "bigint") {
              const statusHex = "0x" + statusValue.toString(16).padStart(64, "0");

              // Map known status hashes to enum values
              // Use centralized status lookup
              status = getStatusByHash(statusHex) ?? QCIStatus.Draft;
            }
            // If it's a string (hex), convert directly
            else if (typeof statusValue === "string" && statusValue.startsWith("0x")) {
              const statusHex = statusValue.toLowerCase();

              // Use centralized status lookup
              status = getStatusByHash(statusHex) ?? QCIStatus.Draft;
            }
            // If it's a small number (0, 1, 2), it's already the correct enum value
            else if (typeof statusValue === "number" && statusValue <= 2) {
              status = statusValue as QCIStatus;
            }
            // Otherwise something went wrong - it's been converted to a large number
            else {
              // Handle scientific notation by converting to string
              const strValue = String(statusValue);

              // Match based on the string representation of scientific notation
              if (strValue.includes("3.557884566192312e+76")) {
                status = QCIStatus.PostedToSnapshot; // This is the most common in migration
              } else if (strValue.includes("8.683815104298986e+76")) {
                status = QCIStatus.Draft;
              } else if (strValue.includes("5.069118969180783e+76")) {
                // This is the Ready for Snapshot hash in scientific notation
                status = QCIStatus.ReadyForSnapshot;
              } else {
                // Default based on QCI number range from migration
                const qciNum = Number(data[0]);
                if (qciNum >= 246) {
                  status = QCIStatus.Draft; // QCIs 246-247 are Draft
                } else {
                  status = QCIStatus.PostedToSnapshot; // QCIs 209-245 are Posted
                }
              }
            }

            qcis.push({
              qciNumber: data[0],
              author: data[1],
              title: data[2],
              chain: data[3],
              contentHash: data[4],
              ipfsUrl: data[5],
              createdAt: data[6],
              lastUpdated: data[7],
              status: status,
              implementor: data[9],
              implementationDate: data[10],
              snapshotProposalId: data[11],
              version: data[12],
            });
          }
        }
      }

      return qcis;
    } catch (error) {
      console.error("Error in multicall batch:", error);
      // Fallback to individual calls if multicall fails
      const qcis: QCI[] = [];
      for (const qciNumber of qciNumbers) {
        try {
          const qci = await this.getQCI(qciNumber);
          qcis.push(qci);
        } catch (e) {
          console.error(`Failed to fetch QCI ${qciNumber}:`, e);
        }
      }
      return qcis;
    }
  }

  /**
   * Get all QCIs by status using multicall for efficiency
   */
  async getAllQCIsByStatusBatch(): Promise<Map<QCIStatus, bigint[]>> {
    // Only use the 3 actual statuses from the contract
    const statuses: QCIStatus[] = [QCIStatus.Draft, QCIStatus.ReadyForSnapshot, QCIStatus.PostedToSnapshot];

    // Split status queries into smaller batches to avoid gas limits
    const BATCH_SIZE = 4; // Each getQCIsByStatus can return many items, so keep batch small
    const statusMap = new Map<QCIStatus, bigint[]>();

    for (let i = 0; i < statuses.length; i += BATCH_SIZE) {
      const batchStatuses = statuses.slice(i, Math.min(i + BATCH_SIZE, statuses.length));

      // Create calls for this batch of statuses
      const calls = batchStatuses.map((status) => ({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "getQCIsByStatus",
        args: [status], // Status is already a number (QCIStatus enum value)
        // gas removed - not supported in multicall parameters
      }));

      try {
        // Batch status queries with gas limit
        const results = await this.publicClient.multicall({
          contracts: calls,
          allowFailure: true,
          // gas removed - not supported in multicall parameters
        });

        for (let j = 0; j < results.length; j++) {
          const result = results[j] as any;
          const status = batchStatuses[j];

          if (result.status === "success" && result.result) {
            statusMap.set(status, result.result as bigint[]);
          } else {
            statusMap.set(status, []);
          }
        }
      } catch (error) {
        console.error("Error in status multicall batch:", error);
        // Fallback to individual calls for this batch
        for (const status of batchStatuses) {
          try {
            const qcis = await this.getQCIsByStatus(status);
            statusMap.set(status, qcis);
          } catch (e) {
            statusMap.set(status, []);
          }
        }
      }
    }

    return statusMap;
  }

  /**
   * Get QCIs by status
   */
  async getQCIsByStatus(status: QCIStatus | string): Promise<bigint[]> {
    try {
      // Convert to numeric status value
      let statusValue: number;
      if (typeof status === "string") {
        const statusMap: Record<string, number> = {
          Draft: QCIStatus.Draft,
          "Ready for Snapshot": QCIStatus.ReadyForSnapshot,
          "Posted to Snapshot": QCIStatus.PostedToSnapshot,
        };
        statusValue = statusMap[status] ?? QCIStatus.Draft;
      } else {
        statusValue = status;
      }

      const result = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "getQCIsByStatus",
        args: [statusValue.toString()],
      });

      // Handle case where result is empty or null
      if (!result || (Array.isArray(result) && result.length === 0)) {
        return [];
      }

      return result as bigint[];
    } catch (error: any) {
      // Handle viem "no data" error which occurs when array is empty
      if (error.message?.includes("returned no data") || error.message?.includes("0x")) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get QCIs by author
   */
  async getQCIsByAuthor(author: Address): Promise<bigint[]> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      functionName: "getQCIsByAuthor",
      args: [author],
    });

    return result as bigint[];
  }

  /**
   * Watch for new QCIs
   */
  watchQCIs(
    callback: (qci: { qciNumber: bigint; author: Address; title: string; chain: string; contentHash: Hash; ipfsUrl: string }) => void
  ) {
    return this.publicClient.watchContractEvent({
      address: this.contractAddress,
      abi: QCI_REGISTRY_ABI,
      eventName: "QCICreated",
      onLogs: (logs) => {
        logs.forEach((log) => {
          const args = log.args as any;
          callback({
            qciNumber: BigInt(log.topics[1]!),
            author: log.topics[2] as Address,
            title: args?.title || "",
            chain: args?.chain || "",
            contentHash: args?.contentHash || "0x",
            ipfsUrl: args?.ipfsUrl || "",
          });
        });
      },
    });
  }

  /**
   * Fetch all statuses from contract
   */
  async fetchAllStatuses(): Promise<{ hashes: string[]; names: string[] }> {
    try {
      // Get the total count of statuses
      const count = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "statusCount",
      })) as bigint;

      if (Number(count) === 0) {
        return { hashes: [], names: [] };
      }

      // Create multicall for all statusAt calls
      const statusAtCalls = [];
      for (let i = 0; i < Number(count); i++) {
        statusAtCalls.push({
          address: this.contractAddress,
          abi: QCI_REGISTRY_ABI,
          functionName: "statusAt",
          args: [BigInt(i)],
        });
      }

      // Batch fetch all status hashes
      const hashResults = await this.publicClient.multicall({
        contracts: statusAtCalls,
        allowFailure: false,
      });

      const hashes = hashResults.map((result) => result as `0x${string}`);

      // Create multicall for all getStatusName calls
      const nameCalls = hashes.map((hash) => ({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "getStatusName",
        args: [hash],
      }));

      // Batch fetch all status names
      const nameResults = await this.publicClient.multicall({
        contracts: nameCalls,
        allowFailure: false,
      });

      const names = nameResults.map((result) => result as string);

      console.log(`[fetchAllStatuses] Fetched ${names.length} statuses in 3 RPC calls (was ${1 + names.length * 2})`);

      return { hashes, names };
    } catch (error) {
      console.error("Failed to fetch statuses from contract:", error);
      // Fallback to known statuses from centralized config if contract call fails
      return {
        hashes: ALL_STATUS_HASHES,
        names: ALL_STATUS_NAMES,
      };
    }
  }

  /**
   * Convert bytes32 hash to readable status name
   * This should use the contract's getStatusName function for accuracy
   */
  private async getStatusStringFromHash(statusHash: string): Promise<string> {
    try {
      // Call the contract's getStatusName function
      const statusName = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "getStatusName",
        args: [statusHash as `0x${string}`],
      })) as string;

      return statusName || "Unknown Status";
    } catch (error) {
      console.error("[QCIClient] Failed to get status name from contract:", error);
      // Fallback to centralized config if contract call fails
      const statusEnum = getStatusByHash(statusHash);
      if (statusEnum !== undefined) {
        return getStatusNameHelper(statusEnum);
      }
      return "Unknown Status";
    }
  }

  /**
   * Convert bytes32 status hash to enum value
   */
  private convertStatusHashToEnum(statusHash: string | number): QCIStatus {
    // Handle if it's already a number (for compatibility)
    if (typeof statusHash === "number") {
      return statusHash as QCIStatus;
    }

    // Convert bytes32 hash to enum using centralized config
    const enumValue = getStatusByHash(statusHash);
    if (enumValue !== undefined) {
      return enumValue;
    }

    // Default to Draft if unknown
    console.warn("Unknown status hash:", statusHash);
    return QCIStatus.Draft;
  }

  /**
   * Get status string from ID (synchronous - uses centralized config)
   */
  getStatusString(status: QCIStatus | string): string {
    // If it's a string (bytes32 hash), convert to enum first
    if (typeof status === "string") {
      status = this.convertStatusHashToEnum(status);
    }

    // Use centralized config for status names
    return getStatusNameHelper(status as QCIStatus);
  }

  /**
   * Helper method to create QCI from QCIContent
   */
  async createQCIFromContent(
    walletClient: WalletClient,
    content: QCIContent,
    ipfsUrl: string
  ): Promise<{ qciNumber: bigint; transactionHash: string }> {
    const contentHash = keccak256(toBytes(content.content));
    const result = await this.createQCI(walletClient, content.title, content.chain, contentHash, ipfsUrl);

    return {
      qciNumber: result.qciNumber,
      transactionHash: result.hash,
    };
  }

  /**
   * Helper method to update QCI from QCIContent
   */
  async updateQCIFromContent(
    walletClient: WalletClient,
    qciNumber: bigint,
    content: QCIContent,
    ipfsUrl: string
  ): Promise<{ version: bigint; transactionHash: string }> {
    const contentHash = keccak256(toBytes(content.content));
    const hash = await this.updateQCI({
      walletClient,
      qciNumber,
      title: content.title,
      chain: content.chain,
      implementor: content.implementor,
      newContentHash: contentHash,
      newIpfsUrl: ipfsUrl,
      changeNote: "Updated via QCI Editor",
    });

    // Get the updated QCI to return the new version
    const updatedQCI = await this.getQCI(qciNumber);

    return {
      version: updatedQCI.version,
      transactionHash: hash,
    };
  }

  /**
   * Update QCI status
   */
  async updateQCIStatus(walletClient: WalletClient, qciNumber: bigint, newStatus: QCIStatus | string): Promise<Hash> {
    if (!walletClient?.account) throw new Error("Wallet client with account required");

    // Convert enum to string status name if needed
    let statusString: string;
    if (typeof newStatus === "string") {
      // Already a string, use as-is
      statusString = newStatus;
    } else {
      // Convert enum value to status string using centralized config
      statusString = STATUS_ENUM_TO_NAME[newStatus as QCIStatus] ?? "Draft";
    }

    try {
      // First estimate gas
      const estimatedGas = await this.publicClient.estimateContractGas({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "updateStatus",
        args: [qciNumber, statusString], // Pass the status string, not the enum value
        account: walletClient.account,
      });
      const { request } = await this.publicClient.simulateContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "updateStatus",
        args: [qciNumber, statusString], // Pass the status string, not the enum value
        account: walletClient.account,
        gas: (estimatedGas * 120n) / 100n, // Add 20% buffer
      });
      const hash = await walletClient.writeContract(request);
      return hash;
    } catch (error) {
      console.error("updateQCIStatus failed:", error);
      console.error("Error details:", {
        message: (error as any)?.message,
        cause: (error as any)?.cause,
        shortMessage: (error as any)?.shortMessage,
        details: (error as any)?.details,
      });
      throw error;
    }
  }

  /**
   * Export complete QCI data including all versions
   */
  async exportQCI(qciNumber: bigint): Promise<QCIExportData> {
    try {
      const data = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "exportQCI",
        args: [qciNumber],
      })) as QCIExportData;

      return data;
    } catch (error) {
      console.error(`Error exporting QCI ${qciNumber}:`, error);
      throw error;
    }
  }

  /**
   * Export multiple QCIs in a single call
   */
  async exportMultipleQCIs(qciNumber: bigint): Promise<QCIExportData> {
    try {
      const data = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "exportQCI",
        args: [qciNumber],
      });

      return data;
    } catch (error) {
      console.error(`Error exporting multiple QCIs:`, error);
      throw error;
    }
  }

  /**
   * Get human-readable status name from contract
   */
  async getStatusName(statusId: Hash): Promise<string> {
    try {
      const statusName = (await this.publicClient.readContract({
        address: this.contractAddress,
        abi: QCI_REGISTRY_ABI,
        functionName: "getStatusName",
        args: [statusId],
      })) as string;

      return statusName;
    } catch (error) {
      console.error(`Error getting status name:`, error);
      // Fallback to default mapping
      return "Unknown";
    }
  }
}
