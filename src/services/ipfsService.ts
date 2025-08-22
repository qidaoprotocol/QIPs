import type { Hash } from 'viem';
import { keccak256, toBytes } from 'viem';
import type { QIPContent } from './qipClient';
// @ts-ignore - no types for ipfs-only-hash
import * as IPFSOnlyHash from 'ipfs-only-hash';

/**
 * Metadata for IPFS uploads
 */
export interface UploadMetadata {
  qipNumber?: number | string;
  groupId?: string;
}

/**
 * Interface for IPFS storage providers
 */
export interface IPFSProvider {
  upload(content: string | Blob, metadata?: UploadMetadata): Promise<string>;
  fetch(cid: string): Promise<string>;
  fetchMultiple?(cids: string[]): Promise<Map<string, string>>;
}

/**
 * Web3.Storage implementation
 */
export class Web3StorageProvider implements IPFSProvider {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async upload(content: string | Blob, metadata?: UploadMetadata): Promise<string> {
    const blob = content instanceof Blob ? content : new Blob([content]);

    const response = await fetch("https://api.web3.storage/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: blob,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const { cid } = await response.json();
    return cid;
  }

  async fetch(cid: string): Promise<string> {
    const response = await fetch(`https://w3s.link/ipfs/${cid}`);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.statusText}`);
    }
    return response.text();
  }
}


/**
 * Local IPFS implementation for development
 */
export class LocalIPFSProvider implements IPFSProvider {
  private apiUrl: string;

  constructor(apiUrl: string = "http://localhost:5001", _gatewayUrl?: string) {
    this.apiUrl = apiUrl;
    // gatewayUrl is not used anymore as we fetch via API
  }

  async upload(content: string | Blob, metadata?: UploadMetadata): Promise<string> {
    const formData = new FormData();
    const blob = content instanceof Blob ? content : new Blob([content], { type: "text/plain" });
    formData.append("file", blob);

    // Request CIDv1 from local IPFS daemon
    const response = await fetch(`${this.apiUrl}/api/v0/add?cid-version=1`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Local IPFS upload failed: ${response.statusText}. Ensure IPFS daemon is running at ${this.apiUrl}`);
    }

    const result = await response.json();
    return result.Hash;
  }

  async fetch(cid: string): Promise<string> {
    // Use the API endpoint for fetching content in local development
    const response = await fetch(`${this.apiUrl}/api/v0/cat?arg=${cid}`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Local IPFS fetch failed: ${response.statusText}. Ensure IPFS daemon is running at ${this.apiUrl}`);
    }
    return response.text();
  }
}

/**
 * Default IPFS gateways for load balancing
 */
export const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud",
  "https://ipfs.io",
  "https://dweb.link",
  "https://nftstorage.link",
  "https://cloudflare-ipfs.com",
  "https://gateway.ipfs.io",
];

/**
 * Pinata implementation with load balanced gateways
 */
export class PinataProvider implements IPFSProvider {
  private jwt: string;
  public readonly gateways: string[];
  private currentGatewayIndex: number = 0;

  constructor(jwt: string, gateway?: string | string[]) {
    this.jwt = jwt;
    
    // Support single gateway, array of gateways, or default to all gateways
    if (Array.isArray(gateway)) {
      this.gateways = gateway;
    } else if (gateway) {
      this.gateways = [gateway, ...IPFS_GATEWAYS.filter(g => g !== gateway)];
    } else {
      this.gateways = [...IPFS_GATEWAYS];
    }
  }

  /**
   * Get the next gateway in round-robin fashion
   */
  private getNextGateway(): string {
    const gateway = this.gateways[this.currentGatewayIndex];
    this.currentGatewayIndex = (this.currentGatewayIndex + 1) % this.gateways.length;
    return gateway;
  }

  async upload(content: string | Blob, metadata?: UploadMetadata): Promise<string> {
    // If content is a string, try to parse it as JSON for more efficient upload
    if (typeof content === "string") {
      try {
        const jsonData = JSON.parse(content);
        return await this.uploadJSON(jsonData, metadata);
      } catch {
        // Not valid JSON, upload as file
        return await this.uploadFile(content, metadata);
      }
    }

    // Blob content, upload as file
    return await this.uploadFile(content);
  }

  private async uploadJSON(data: any, metadata?: UploadMetadata): Promise<string> {
    const body = {
      pinataContent: data,
      pinataOptions: {
        cidVersion: 1,  // Use CIDv1 (modern IPFS standard)
        ...(metadata?.groupId && { groupId: metadata.groupId }),
      },
      pinataMetadata: {
        name: `QIP-${metadata?.qipNumber || data.qip || "draft"}.json`,
        keyvalues: {
          type: "qip-proposal",
          qip: String(metadata?.qipNumber || data.qip || "draft"),
          network: data.network || "unknown",
        },
      },
    };

    const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata JSON upload failed: ${response.statusText} - ${errorText}`);
    }

    const { IpfsHash } = await response.json();
    return IpfsHash;
  }

  private async uploadFile(content: string | Blob, metadata?: UploadMetadata): Promise<string> {
    const formData = new FormData();
    const blob = content instanceof Blob ? content : new Blob([content], { type: "text/plain" });

    // Generate a filename based on content
    const filename = content instanceof Blob ? "file.txt" : "qip-content.md";
    formData.append("file", blob, filename);

    // Add pinata metadata
    const pinataMetadataJson = JSON.stringify({
      name: filename,
      keyvalues: {
        type: "qip-content",
      },
    });
    formData.append("pinataMetadata", pinataMetadataJson);
    
    // Add pinata options to explicitly use CIDv1 (bafkrei...)
    const pinataOptionsJson = JSON.stringify({
      cidVersion: 1,  // Use CIDv1 (modern IPFS standard)
      ...(metadata?.groupId && { groupId: metadata.groupId }),
    });
    formData.append("pinataOptions", pinataOptionsJson);

    const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.jwt}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Pinata file upload failed: ${response.statusText} - ${errorText}`);
    }

    const { IpfsHash } = await response.json();
    return IpfsHash;
  }

  async fetch(cid: string): Promise<string> {
    // Race multiple gateways in parallel for fastest response
    const gatewaysToRace = Math.min(3, this.gateways.length);
    const usedGateways = new Set<string>();
    
    // Create abort controller for canceling slower requests
    const abortController = new AbortController();
    
    const fetchFromGateway = async (gateway: string): Promise<string> => {
      const url = `${gateway}/ipfs/${cid}`;
      
      try {
        console.debug(`[IPFS] Racing fetch from: ${gateway}`);
        const response = await fetch(url, {
          signal: abortController.signal,
        });
        
        if (!response.ok) {
          if (response.status === 429) {
            throw new Error(`Rate limited on ${gateway}`);
          }
          throw new Error(`${gateway} failed: ${response.statusText}`);
        }
        
        const text = await response.text();
        console.debug(`[IPFS] ✅ Fastest response from: ${gateway}`);
        
        // Cancel other requests since we got a response
        abortController.abort();
        
        return text;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.debug(`[IPFS] Request to ${gateway} was cancelled (slower)`);
        } else {
          console.warn(`[IPFS] Failed to fetch from ${gateway}:`, error.message);
        }
        throw error;
      }
    };
    
    // Get unique gateways for racing
    const gatewaysForRacing: string[] = [];
    for (let i = 0; i < gatewaysToRace; i++) {
      const gateway = this.getNextGateway();
      if (!usedGateways.has(gateway)) {
        usedGateways.add(gateway);
        gatewaysForRacing.push(gateway);
      }
    }
    
    try {
      // Race all gateways in parallel
      const result = await Promise.race(
        gatewaysForRacing.map(gateway => fetchFromGateway(gateway))
      );
      
      return result;
    } catch (firstRaceError) {
      console.warn('[IPFS] First race failed, trying backup gateways...');
      
      // If all racing gateways failed, try remaining gateways sequentially
      let lastError: Error = firstRaceError as Error;
      
      for (const gateway of this.gateways) {
        if (usedGateways.has(gateway)) continue;
        
        try {
          console.debug(`[IPFS] Trying backup gateway: ${gateway}`);
          const url = `${gateway}/ipfs/${cid}`;
          const response = await fetch(url, {
            signal: AbortSignal.timeout(10000),
          });
          
          if (!response.ok) {
            throw new Error(`Fetch failed: ${response.statusText}`);
          }
          
          return response.text();
        } catch (error: any) {
          lastError = error;
        }
      }
      
      throw lastError || new Error(`Failed to fetch CID ${cid} from all gateways`);
    }
  }

  /**
   * Fetch multiple CIDs concurrently using different gateways
   */
  async fetchMultiple(cids: string[]): Promise<Map<string, string>> {
    console.debug(`[Pinata] Fetching ${cids.length} QIPs concurrently across ${this.gateways.length} gateways`);
    
    const results = new Map<string, string>();
    const errors = new Map<string, Error>();
    
    // Create fetch promises with rotating gateways
    const fetchPromises = cids.map(async (cid, index) => {
      // Use a different gateway for each CID to spread the load
      const gateway = this.gateways[index % this.gateways.length];
      const url = `${gateway}/ipfs/${cid}`;
      
      try {
        console.debug(`[Pinata] Fetching CID ${cid} from gateway ${gateway}`);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000), // 15 second timeout per request
        });
        
        if (!response.ok) {
          throw new Error(`${gateway} returned ${response.status}: ${response.statusText}`);
        }
        
        const content = await response.text();
        results.set(cid, content);
        console.debug(`[Pinata] ✅ Successfully fetched ${cid} from ${gateway}`);
      } catch (error: any) {
        console.warn(`[Pinata] Failed to fetch ${cid} from ${gateway}:`, error.message);
        errors.set(cid, error);
        
        // Retry with a different gateway
        const retryGateway = this.gateways[(index + 1) % this.gateways.length];
        const retryUrl = `${retryGateway}/ipfs/${cid}`;
        
        try {
          console.debug(`[Pinata] Retrying ${cid} with ${retryGateway}`);
          const response = await fetch(retryUrl, {
            signal: AbortSignal.timeout(10000),
          });
          
          if (response.ok) {
            const content = await response.text();
            results.set(cid, content);
            errors.delete(cid);
            console.debug(`[Pinata] ✅ Retry successful for ${cid} from ${retryGateway}`);
          }
        } catch (retryError: any) {
          console.error(`[Pinata] Retry failed for ${cid}:`, retryError.message);
        }
      }
    });
    
    // Wait for all fetches to complete
    await Promise.allSettled(fetchPromises);
    
    console.debug(`[Pinata] Fetched ${results.size}/${cids.length} QIPs successfully`);
    if (errors.size > 0) {
      console.warn(`[Pinata] Failed to fetch ${errors.size} QIPs:`, Array.from(errors.keys()));
    }
    
    return results;
  }
}

/**
 * Mai API Provider - Uses mai-api endpoint for IPFS uploads (Pinata-compatible)
 */
export class MaiAPIProvider implements IPFSProvider {
  private apiUrl: string;
  public readonly gateways: string[];
  private currentGatewayIndex: number = 0;

  constructor(apiUrl: string = "http://localhost:3001/v2/ipfs-upload") {
    this.apiUrl = apiUrl;
    this.gateways = [...IPFS_GATEWAYS];
  }

  /**
   * Get the next gateway in round-robin fashion
   */
  private getNextGateway(): string {
    const gateway = this.gateways[this.currentGatewayIndex];
    this.currentGatewayIndex = (this.currentGatewayIndex + 1) % this.gateways.length;
    return gateway;
  }

  async upload(content: string | Blob, metadata?: UploadMetadata): Promise<string> {
    // Convert Blob to string if needed
    let contentString: string;
    let isJson = false;

    if (content instanceof Blob) {
      contentString = await content.text();
    } else {
      contentString = content;
    }

    // Try to parse as JSON to determine the upload format
    let jsonData: any = null;
    try {
      jsonData = JSON.parse(contentString);
      isJson = true;
    } catch {
      // Not JSON, treat as plain text/markdown
      isJson = false;
    }

    let requestBody: any;

    if (isJson) {
      // For JSON data, use Pinata's JSON upload format
      // Check if it already has QIP structure
      const hasQIPStructure = jsonData.qip !== undefined || jsonData.title !== undefined;

      if (hasQIPStructure) {
        // Upload with metadata
        requestBody = {
          pinataContent: jsonData,
          pinataMetadata: {
            name: `QIP-${metadata?.qipNumber || jsonData.qip || "draft"}.json`,
            keyvalues: {
              type: "qip-proposal",
              qip: String(metadata?.qipNumber || jsonData.qip || "draft"),
              network: jsonData.network || "unknown",
              author: jsonData.author || "unknown",
            },
          },
          pinataOptions: {
            cidVersion: 1,  // Use CIDv1 (modern IPFS standard)
            ...(metadata?.groupId && { groupId: metadata.groupId }),
          },
        };
      } else {
        // Direct JSON upload
        requestBody = jsonData;
      }
    } else {
      // For plain text/markdown, wrap it in a JSON structure
      requestBody = {
        pinataContent: {
          content: contentString,
          type: "markdown",
        },
        pinataMetadata: {
          name: `QIP-${metadata?.qipNumber || "content"}.json`,
          keyvalues: {
            type: "qip-content",
            format: "markdown",
            ...(metadata?.qipNumber && { qip: String(metadata.qipNumber) }),
          },
        },
        pinataOptions: {
          cidVersion: 1,  // Use CIDv1 (modern IPFS standard)
          ...(metadata?.groupId && { groupId: metadata.groupId }),
        },
      };
    }

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      const errorMessage = error.error?.details || error.error?.reason || error.error || response.statusText;
      throw new Error(`Mai API upload failed: ${errorMessage}`);
    }

    const result = await response.json();

    // Check for Pinata-compatible response format
    if (result.IpfsHash) {
      return result.IpfsHash;
    }

    // Fallback to old format
    if (result.ipfsHash) {
      return result.ipfsHash;
    }

    throw new Error("Invalid response from Mai API: missing IPFS hash");
  }

  async fetch(cid: string): Promise<string> {
    // In development mode with mock hashes (they start with Qm307... which is our mock prefix)
    if (cid.startsWith("Qm307")) {
      console.log("Development mode: Mock IPFS hash detected, returning placeholder content");
      return `---
qip: 999
title: Mock Content
network: Base
status: Draft
author: Development
implementor: None
implementation-date: None
proposal: None
created: 2024-01-01
---

# Mock Content

This is placeholder content for development mode.`;
    }

    // Try multiple gateways with load balancing
    let lastError: Error | null = null;
    const maxRetries = Math.min(3, this.gateways.length);
    
    for (let i = 0; i < maxRetries; i++) {
      const gateway = this.getNextGateway();
      const url = `${gateway}/ipfs/${cid}`;
      
      try {
        console.debug(`MaiAPI: Fetching from IPFS gateway ${i + 1}/${maxRetries}: ${gateway}`);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });
        
        if (!response.ok) {
          if (response.status === 429) {
            console.warn(`Rate limited on ${gateway}, trying next...`);
            lastError = new Error(`Rate limited: ${response.statusText}`);
            continue;
          }
          throw new Error(`Fetch failed: ${response.statusText}`);
        }
        
        return response.text();
      } catch (error: any) {
        console.warn(`Failed to fetch from ${gateway}:`, error.message);
        lastError = error;
        
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    
    throw lastError || new Error(`Failed to fetch CID ${cid} from all gateways`);
  }

  /**
   * Fetch multiple CIDs concurrently using different gateways
   */
  async fetchMultiple(cids: string[]): Promise<Map<string, string>> {
    console.debug(`[MaiAPI] Fetching ${cids.length} QIPs concurrently across ${this.gateways.length} gateways`);
    
    const results = new Map<string, string>();
    const errors = new Map<string, Error>();
    
    // Create fetch promises with rotating gateways
    const fetchPromises = cids.map(async (cid, index) => {
      // Use a different gateway for each CID
      const gateway = this.gateways[index % this.gateways.length];
      const url = `${gateway}/ipfs/${cid}`;
      
      try {
        console.debug(`[MaiAPI] Fetching CID ${cid} from gateway ${gateway}`);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000), // 15 second timeout per request
        });
        
        if (!response.ok) {
          throw new Error(`${gateway} returned ${response.status}: ${response.statusText}`);
        }
        
        const content = await response.text();
        results.set(cid, content);
        console.debug(`[MaiAPI] ✅ Successfully fetched ${cid} from ${gateway}`);
      } catch (error: any) {
        console.warn(`[MaiAPI] Failed to fetch ${cid} from ${gateway}:`, error.message);
        errors.set(cid, error);
        
        // Retry with a different gateway
        const retryGateway = this.gateways[(index + 1) % this.gateways.length];
        const retryUrl = `${retryGateway}/ipfs/${cid}`;
        
        try {
          console.debug(`[MaiAPI] Retrying ${cid} with ${retryGateway}`);
          const response = await fetch(retryUrl, {
            signal: AbortSignal.timeout(10000),
          });
          
          if (response.ok) {
            const content = await response.text();
            results.set(cid, content);
            errors.delete(cid);
            console.debug(`[MaiAPI] ✅ Retry successful for ${cid} from ${retryGateway}`);
          }
        } catch (retryError: any) {
          console.error(`[MaiAPI] Retry failed for ${cid}:`, retryError.message);
        }
      }
    });
    
    // Wait for all fetches to complete
    await Promise.allSettled(fetchPromises);
    
    console.debug(`[MaiAPI] Fetched ${results.size}/${cids.length} QIPs successfully`);
    if (errors.size > 0) {
      console.warn(`[MaiAPI] Failed to fetch ${errors.size} QIPs:`, Array.from(errors.keys()));
    }
    
    return results;
  }

}

/**
 * Main IPFS service for managing QIPs
 */
export class IPFSService {
  public readonly provider: IPFSProvider;

  constructor(provider: IPFSProvider) {
    this.provider = provider;
  }

  /**
   * Calculate IPFS CID without uploading
   * @param content The content to hash
   * @returns The CID that would be generated if uploaded
   */
  async calculateCID(content: string): Promise<string> {
    try {
      // Check which provider is being used to determine content format
      let contentToHash: string;
      
      // If using MaiAPIProvider and content is markdown (not JSON)
      if (this.provider instanceof MaiAPIProvider) {
        try {
          // Try to parse as JSON - if it succeeds, it's already JSON
          JSON.parse(content);
          contentToHash = content;
        } catch {
          // Not JSON, so it's markdown that will be wrapped
          // MaiAPIProvider wraps markdown in this format for IPFS storage
          const wrappedContent = {
            content: content,
            type: "markdown"
          };
          contentToHash = JSON.stringify(wrappedContent);
        }
      } else {
        // For other providers, use content as-is
        contentToHash = content;
      }
      
      // Use ipfs-only-hash to calculate the CID
      // IMPORTANT: Use CIDv1 with raw codec to match Pinata's behavior
      // Pinata uses raw codec for JSON uploads, which produces bafkrei... CIDs
      const cid = await IPFSOnlyHash.of(contentToHash, { 
        cidVersion: 1,
        rawLeaves: true,
        codec: 'raw'
      });
      return cid;
    } catch (error) {
      console.error("Error calculating CID:", error);
      throw new Error("Failed to calculate IPFS CID");
    }
  }

  /**
   * Calculate content hash for blockchain storage
   * Uses keccak256 hash of the QIP content
   */
  calculateContentHash(qipContent: QIPContent): Hash {
    // Calculate content hash including title, author, timestamp, and content to ensure uniqueness
    const uniqueContent = JSON.stringify({
      title: qipContent.title,
      author: qipContent.author,
      timestamp: Date.now(),
      content: qipContent.content,
    });
    return keccak256(toBytes(uniqueContent));
  }

  /**
   * Upload QIP content to IPFS from structured data
   */
  async uploadQIPFromContent(qipContent: QIPContent): Promise<{
    cid: string;
    ipfsUrl: string;
    contentHash: Hash;
  }> {
    // Format as markdown with YAML frontmatter
    const fullContent = this.formatQIPContent(qipContent);

    // Calculate content hash including title, author, timestamp, and content to ensure uniqueness
    const uniqueContent = JSON.stringify({
      title: qipContent.title,
      author: qipContent.author,
      content: qipContent.content,
      created: qipContent.created,
      timestamp: Date.now(),
    });
    const contentHash = keccak256(toBytes(uniqueContent));

    // Upload to IPFS
    const cid = await this.provider.upload(fullContent);
    const ipfsUrl = `ipfs://${cid}`;

    return {
      cid,
      ipfsUrl,
      contentHash,
    };
  }

  /**
   * Format QIP content with YAML frontmatter
   */
  public formatQIPContent(qipData: QIPContent): string {
    return `---
qip: ${qipData.qip}
title: ${qipData.title}
network: ${qipData.network}
status: ${qipData.status}
author: ${qipData.author}
implementor: ${qipData.implementor}
implementation-date: ${qipData["implementation-date"]}
proposal: ${qipData.proposal}
created: ${qipData.created}
---

${qipData.content}`;
  }

  /**
   * Upload raw markdown content
   */
  async uploadRawContent(content: string): Promise<{
    cid: string;
    ipfsUrl: string;
    contentHash: Hash;
  }> {
    // Calculate content hash
    const contentHash = keccak256(toBytes(content));

    // Upload to IPFS
    const cid = await this.provider.upload(content);
    const ipfsUrl = `ipfs://${cid}`;

    return {
      cid,
      ipfsUrl,
      contentHash,
    };
  }

  /**
   * Fetch and parse QIP from IPFS
   */
  async fetchQIP(cidOrUrl: string): Promise<string> {
    // Extract CID from URL if needed
    const cid = cidOrUrl.startsWith("ipfs://") ? cidOrUrl.slice(7) : cidOrUrl;

    const rawContent = await this.provider.fetch(cid);
    return this.processIPFSContent(rawContent, cid);
  }

  /**
   * Convert JSON QIP structure to markdown format
   */
  private formatQIPFromJSON(data: any): string {
    // Extract content if it exists
    const content = data.content || "";
    
    // Build frontmatter from the JSON data
    const frontmatter = [
      `qip: ${data.qip || "unknown"}`,
      `title: ${data.title || "Untitled"}`,
      `network: ${data.network || "unknown"}`,
      `status: ${data.status || "Draft"}`,
      `author: ${data.author || "unknown"}`,
      `implementor: ${data.implementor || "None"}`,
      `implementation-date: ${data["implementation-date"] || data.implementationDate || "None"}`,
      `proposal: ${data.proposal || "None"}`,
      `created: ${data.created || new Date().toISOString().split("T")[0]}`,
    ].join("\n");

    return `---\n${frontmatter}\n---\n\n${content}`;
  }

  /**
   * Fetch multiple QIPs concurrently using provider's optimized method if available
   */
  async fetchMultipleQIPs(cids: string[]): Promise<Map<string, string>> {
    // Use provider's optimized fetchMultiple if available
    if (this.provider.fetchMultiple) {
      console.debug(`[IPFSService] Using provider's optimized fetchMultiple for ${cids.length} CIDs`);
      const results = await this.provider.fetchMultiple(cids);
      
      // Process each result to handle JSON unwrapping (same logic as fetchQIP but without fetching)
      const processedResults = new Map<string, string>();
      for (const [cid, rawContent] of results) {
        try {
          // Apply the same JSON unwrapping logic as fetchQIP
          const processedContent = this.processIPFSContent(rawContent, cid);
          processedResults.set(cid, processedContent);
        } catch (error) {
          console.warn(`[IPFSService] Failed to process content for CID ${cid}:`, error);
          // Try to use raw content as fallback
          processedResults.set(cid, rawContent);
        }
      }
      
      return processedResults;
    }
    
    // Fallback to sequential fetching if provider doesn't support batch
    console.debug(`[IPFSService] Provider doesn't support fetchMultiple, falling back to sequential`);
    const results = new Map<string, string>();
    
    for (const cid of cids) {
      try {
        const content = await this.fetchQIP(cid);
        results.set(cid, content);
      } catch (error) {
        console.error(`[IPFSService] Failed to fetch CID ${cid}:`, error);
      }
    }
    
    return results;
  }
  
  /**
   * Process IPFS content to handle various JSON wrapping formats
   */
  private processIPFSContent(rawContent: string, cid: string): string {
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(rawContent);
      
      // Check if it's a valid JSON object
      if (typeof parsed === "object" && parsed !== null) {
        // Case 1: Full QIP JSON structure (has qip, title, etc. - check this first)
        if ("qip" in parsed || "title" in parsed) {
          console.debug(`Converting full QIP JSON structure to markdown for CID: ${cid}`);
          // Convert the JSON structure to markdown format
          const frontmatter = [
            `qip: ${parsed.qip || "unknown"}`,
            `title: ${parsed.title || "Untitled"}`,
            `network: ${parsed.network || "unknown"}`,
            `status: ${parsed.status || "Draft"}`,
            `author: ${parsed.author || "unknown"}`,
            `implementor: ${parsed.implementor || "None"}`,
            `implementation-date: ${parsed["implementation-date"] || parsed.implementationDate || "None"}`,
            `proposal: ${parsed.proposal || "None"}`,
            `created: ${parsed.created || new Date().toISOString().split("T")[0]}`,
          ].join("\n");
          
          const content = parsed.content || "";
          return `---\n${frontmatter}\n---\n\n${content}`;
        }
        
        // Case 2: JSON with 'content' field and 'type' field (MaiAPIProvider format)
        if ("content" in parsed && "type" in parsed && parsed.type === "markdown") {
          console.debug(`Unwrapping MaiAPI JSON-wrapped markdown for CID: ${cid}`);
          return parsed.content;
        }
        
        // Case 3: Simple JSON with just 'content' field
        if ("content" in parsed && typeof parsed.content === "string") {
          console.debug(`Unwrapping simple JSON-wrapped content for CID: ${cid}`);
          return parsed.content;
        }
      }

      // If it's some other JSON structure, return as-is
      return rawContent;
    } catch {
      // Not JSON, return raw content (markdown)
      return rawContent;
    }
  }

  /**
   * Upload pre-formatted QIP markdown content with metadata
   */
  async uploadQIP(
    markdownContent: string,
    _metadata?: {
      name?: string;
      qipNumber?: string;
      title?: string;
      author?: string;
      version?: string;
    }
  ): Promise<string> {
    // Upload to IPFS
    // Note: metadata is currently unused but kept for future enhancements
    const cid = await this.provider.upload(markdownContent);
    return `ipfs://${cid}`;
  }

  /**
   * Generate QIP markdown from frontmatter and content
   */
  generateQIPMarkdown(frontmatter: Record<string, any>, content: string): string {
    const frontmatterLines = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");

    return `---\n${frontmatterLines}\n---\n\n${content}`;
  }

  /**
   * Parse QIP markdown to extract frontmatter and content
   */
  parseQIPMarkdown(markdown: string | any): {
    frontmatter: Record<string, any>;
    content: string;
  } {
    // Ensure we have a string to work with
    if (typeof markdown !== "string") {
      console.error("parseQIPMarkdown received non-string:", typeof markdown, markdown);
      // Try to handle JSON objects that might have been passed directly
      if (typeof markdown === "object" && markdown !== null) {
        // If it's already a parsed QIP object, convert it to markdown first
        if ("qip" in markdown || "title" in markdown) {
          const obj = markdown as any;
          const frontmatter = [
            `qip: ${obj.qip || "unknown"}`,
            `title: ${obj.title || "Untitled"}`,
            `network: ${obj.network || "unknown"}`,
            `status: ${obj.status || "Draft"}`,
            `author: ${obj.author || "unknown"}`,
            `implementor: ${obj.implementor || "None"}`,
            `implementation-date: ${obj["implementation-date"] || obj.implementationDate || "None"}`,
            `proposal: ${obj.proposal || "None"}`,
            `created: ${obj.created || new Date().toISOString().split("T")[0]}`,
          ].join("\n");
          
          const content = obj.content || "";
          markdown = `---\n${frontmatter}\n---\n\n${content}`;
        } else {
          throw new Error("Invalid QIP format: expected string content or QIP object");
        }
      } else {
        throw new Error("Invalid QIP format: expected string content");
      }
    }

    // Trim whitespace
    markdown = markdown.trim();

    if (!markdown) {
      throw new Error("Invalid QIP format: empty content");
    }

    // Check for frontmatter
    const match = markdown.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);

    if (!match) {
      // Log the first 200 chars for debugging
      console.error("Failed to parse QIP markdown. First 200 chars:", markdown.substring(0, 200));
      throw new Error('Invalid QIP format: missing frontmatter. Content must start with "---" delimiter');
    }

    const yamlContent = match[1];
    const content = match[2].trim();

    // Simple YAML parsing
    const frontmatter: Record<string, any> = {};
    const lines = yamlContent.split("\n");

    for (const line of lines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        // Restore the None -> null conversion
        frontmatter[key] = value === "None" ? null : value;
      }
    }

    return { frontmatter, content };
  }

  /**
   * Verify QIP content matches hash
   */
  verifyContentHash(content: string, expectedHash: Hash): boolean {
    const actualHash = keccak256(toBytes(content));
    return actualHash === expectedHash;
  }

  /**
   * Get gateway URL for a CID
   */
  getGatewayUrl(cidOrUrl: string): string {
    const cid = cidOrUrl.startsWith("ipfs://") ? cidOrUrl.slice(7) : cidOrUrl;

    if (this.provider instanceof Web3StorageProvider) {
      return `https://w3s.link/ipfs/${cid}`;
    } else if (this.provider instanceof PinataProvider || this.provider instanceof MaiAPIProvider) {
      // Use the first available gateway from the provider's list
      const gateway = this.provider.gateways?.[0] || 'https://gateway.pinata.cloud';
      return `${gateway}/ipfs/${cid}`;
    } else if (this.provider instanceof LocalIPFSProvider) {
      return `http://localhost:8080/ipfs/${cid}`;
    }

    // Default gateway
    return `https://ipfs.io/ipfs/${cid}`;
  }

  /**
   * Upload JSON data to IPFS
   */
  async uploadJSON(data: any): Promise<string> {
    const json = JSON.stringify(data, null, 2);
    return await this.provider.upload(json);
  }

  /**
   * Fetch and parse JSON from IPFS
   */
  async fetchJSON<T = any>(cidOrUrl: string): Promise<T> {
    const content = await this.fetchQIP(cidOrUrl);
    return JSON.parse(content);
  }
}