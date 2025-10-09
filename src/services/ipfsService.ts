import type { Hash } from 'viem';
import { keccak256, toBytes } from 'viem';
import type { QCIContent } from './qciClient';
// @ts-ignore - no types for ipfs-only-hash
import * as IPFSOnlyHash from 'ipfs-only-hash';

/**
 * Metadata for IPFS uploads
 */
export interface UploadMetadata {
  qciNumber?: number | string;
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
    let finalContent: string;
    if (content instanceof Blob) {
      finalContent = await content.text();
    } else {
      finalContent = content;
    }

    // IMPORTANT: Match the wrapping behavior used in calculateCID
    const isMarkdown = finalContent.trim().startsWith('---');
    if (isMarkdown) {
      const wrappedContent = { content: finalContent };
      finalContent = JSON.stringify(wrappedContent);
    }

    const formData = new FormData();
    const blob = new Blob([finalContent], { type: "application/json" });
    formData.append("file", blob);

    // Request CIDv1 with raw codec to match calculateCID
    const response = await fetch(`${this.apiUrl}/api/v0/add?cid-version=1&raw-leaves=true`, {
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
    const url = `${this.apiUrl}/api/v0/cat?arg=${cid}`;

    const response = await fetch(url, {
      method: "POST",
    });

    if (!response.ok) {
      console.error(`Local IPFS fetch failed: ${response.status} ${response.statusText}`);
      throw new Error(`Local IPFS fetch failed: ${response.statusText}. Ensure IPFS daemon is running at ${this.apiUrl}`);
    }

    const content = await response.text();
    return content;
  }
}

/**
 * Get IPFS gateway from environment or use default
 */
export const getIPFSGateway = (): string => {
  // Check for environment variable
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_IPFS_GATEWAY) {
    return import.meta.env.VITE_IPFS_GATEWAY;
  }
  // Fallback to default
  return "https://gateway.pinata.cloud";
};

/**
 * Pinata implementation with IPFS gateway
 */
export class PinataProvider implements IPFSProvider {
  private jwt: string;
  public readonly gateway: string;

  constructor(jwt: string, gateway?: string) {
    this.jwt = jwt;
    this.gateway = gateway || getIPFSGateway();
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
        name: `QCI-${metadata?.qciNumber || data.qci || "draft"}.json`,
        keyvalues: {
          type: "qci-proposal",
          qci: String(metadata?.qciNumber || data.qci || "draft"),
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
    const filename = content instanceof Blob ? "file.txt" : "qci-content.md";
    formData.append("file", blob, filename);

    // Add pinata metadata
    const pinataMetadataJson = JSON.stringify({
      name: filename,
      keyvalues: {
        type: "qci-content",
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

    const url = `${this.gateway}/ipfs/${cid}`;
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      console.log(`[IPFS-FETCH-DEBUG] Response status: ${response.status}`);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(`Rate limited on gateway`);
        }
        throw new Error(`Gateway failed: ${response.statusText}`);
      }

      const text = await response.text();
      const fetchTime = Date.now() - startTime;

      // Validate response content
      if (!text || text.length === 0) {
        throw new Error(`Empty response from gateway`);
      }

      // Check if response looks like an error page
      if (text.includes("404") || text.includes("Not Found") || text.includes("Gateway Timeout")) {
        throw new Error(`Invalid response from gateway: possibly an error page`);
      }

      console.log(`[IPFS-FETCH-DEBUG] ✅ Got response in ${fetchTime}ms (${text.length} bytes)`);
      return text;

    } catch (error: any) {
      console.error(`[IPFS-FETCH-DEBUG] ❌ Failed to fetch from gateway:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch multiple CIDs concurrently
   */
  async fetchMultiple(cids: string[]): Promise<Map<string, string>> {
    console.debug(`[Pinata] Fetching ${cids.length} QCIs`);

    const results = new Map<string, string>();
    const errors = new Map<string, Error>();

    // Create fetch promises
    const fetchPromises = cids.map(async (cid) => {
      try {
        const content = await this.fetch(cid);
        results.set(cid, content);
        console.debug(`[Pinata] ✅ Successfully fetched ${cid}`);
      } catch (error: any) {
        console.warn(`[Pinata] Failed to fetch ${cid}:`, error.message);
        errors.set(cid, error);
      }
    });

    // Wait for all fetches to complete
    await Promise.allSettled(fetchPromises);

    console.debug(`[Pinata] Fetched ${results.size}/${cids.length} QCIs successfully`);
    if (errors.size > 0) {
      console.warn(`[Pinata] Failed to fetch ${errors.size} QCIs:`, Array.from(errors.keys()));
    }

    return results;
  }
}

/**
 * Mai API Provider - Uses mai-api endpoint for IPFS uploads (Pinata-compatible)
 */
export class MaiAPIProvider implements IPFSProvider {
  private apiUrl: string;
  public readonly gateway: string;

  constructor(apiUrl: string = "http://localhost:3001/v2/ipfs-upload") {
    this.apiUrl = apiUrl;
    this.gateway = getIPFSGateway();
  }

  async upload(content: string | Blob, metadata?: UploadMetadata): Promise<string> {
    // Convert Blob to string if needed
    let contentString: string;

    if (content instanceof Blob) {
      contentString = await content.text();
    } else {
      contentString = content;
    }

    // IMPORTANT: Match the wrapping behavior used in calculateCID and LocalIPFSProvider
    // This ensures consistent CID calculation across all providers

    let requestBody: any;

    // Try to parse as JSON to check if it's already structured
    try {
      const jsonData = JSON.parse(contentString);

      // If it has QCI structure, send with metadata
      if (jsonData.qci !== undefined || jsonData.title !== undefined) {
        requestBody = {
          pinataContent: jsonData,
          pinataMetadata: {
            name: `QCI-${metadata?.qciNumber || jsonData.qci || "draft"}.json`,
            keyvalues: {
              type: "qci-proposal",
              qci: String(metadata?.qciNumber || jsonData.qci || "draft"),
              network: jsonData.network || "unknown",
              author: jsonData.author || "unknown",
            },
          },
          pinataOptions: {
            cidVersion: 1,
            ...(metadata?.groupId && { groupId: metadata.groupId }),
          },
        };
      } else {
        // It's JSON but not QCI structure, send as-is
        requestBody = {
          pinataContent: jsonData,
          pinataMetadata: {
            name: `QCI-${metadata?.qciNumber || "draft"}.json`,
            keyvalues: {
              type: "qci-proposal",
              qci: String(metadata?.qciNumber || "draft"),
            },
          },
        };
      }
    } catch {
      // Not JSON - check if it's markdown that needs wrapping
      const isMarkdown = contentString.trim().startsWith('---');

      if (isMarkdown) {
        // Wrap markdown in JSON structure to match LocalIPFSProvider and calculateCID
        const wrappedContent = { content: contentString };
        requestBody = {
          pinataContent: wrappedContent,
          pinataMetadata: {
            name: `QCI-${metadata?.qciNumber || "draft"}.json`,
            keyvalues: {
              type: "qci-proposal",
              qci: String(metadata?.qciNumber || "draft"),
            },
          },
          pinataOptions: {
            cidVersion: 1,
            ...(metadata?.groupId && { groupId: metadata.groupId }),
          },
        };
      } else {
        // Plain text or other content - send as-is
        requestBody = {
          pinataContent: contentString,
          pinataMetadata: {
            name: `QCI-${metadata?.qciNumber || "draft"}.txt`,
            keyvalues: {
              type: "qci-proposal",
              qci: String(metadata?.qciNumber || "draft"),
            },
          },
        };
      }
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
qci: 999
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

    // Fetch from the gateway
    const url = `${this.gateway}/ipfs/${cid}`;

    try {
      console.debug(`MaiAPI: Fetching from IPFS gateway: ${this.gateway}`);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(`Rate limited: ${response.statusText}`);
        }
        throw new Error(`Fetch failed: ${response.statusText}`);
      }

      return response.text();
    } catch (error: any) {
      console.error(`Failed to fetch from gateway:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch multiple CIDs concurrently
   */
  async fetchMultiple(cids: string[]): Promise<Map<string, string>> {
    console.debug(`[MaiAPI] Fetching ${cids.length} QCIs`);

    const results = new Map<string, string>();
    const errors = new Map<string, Error>();

    // Create fetch promises
    const fetchPromises = cids.map(async (cid) => {
      try {
        const content = await this.fetch(cid);
        results.set(cid, content);
        console.debug(`[MaiAPI] ✅ Successfully fetched ${cid}`);
      } catch (error: any) {
        console.warn(`[MaiAPI] Failed to fetch ${cid}:`, error.message);
        errors.set(cid, error);
      }
    });

    // Wait for all fetches to complete
    await Promise.allSettled(fetchPromises);

    console.debug(`[MaiAPI] Fetched ${results.size}/${cids.length} QCIs successfully`);
    if (errors.size > 0) {
      console.warn(`[MaiAPI] Failed to fetch ${errors.size} QCIs:`, Array.from(errors.keys()));
    }

    return results;
  }

}

/**
 * Main IPFS service for managing QCIs
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
      // IMPORTANT: The Mai API wraps markdown content in { content: "..." } before uploading
      // We need to match this wrapping when calculating the CID

      const isMarkdown = content.trim().startsWith('---');

      let contentToHash: string;
      if (isMarkdown) {
        // Wrap markdown in JSON structure to match what the API does
        const wrappedContent = { content: content };
        contentToHash = JSON.stringify(wrappedContent);
        // Wrap markdown in JSON structure to match what the API does
      } else {
        // Already JSON or other format, use as-is
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
      console.error("[IPFSService] Error calculating CID:", error);
      throw new Error("Failed to calculate IPFS CID");
    }
  }

  /**
   * Calculate content hash for blockchain storage
   * Uses keccak256 hash of the QCI content
   */
  calculateContentHash(qciContent: QCIContent): Hash {
    // Calculate content hash including title, author, timestamp, content, and transactions to ensure uniqueness
    const uniqueContent = JSON.stringify({
      title: qciContent.title,
      author: qciContent.author,
      timestamp: Date.now(),
      content: qciContent.content,
      transactions: qciContent.transactions || []
    });
    return keccak256(toBytes(uniqueContent));
  }

  /**
   * Upload QCI content to IPFS from structured data
   */
  async uploadQCIFromContent(qciContent: QCIContent): Promise<{
    cid: string;
    ipfsUrl: string;
    contentHash: Hash;
  }> {
    // Format as markdown with YAML frontmatter
    const fullContent = this.formatQCIContent(qciContent);

    // Calculate content hash including title, author, timestamp, and content to ensure uniqueness
    const uniqueContent = JSON.stringify({
      title: qciContent.title,
      author: qciContent.author,
      content: qciContent.content,
      created: qciContent.created,
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
   * Format QCI content with YAML frontmatter
   */
  public formatQCIContent(qciData: QCIContent): string {
    let formatted = `---
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
      formatted += '\n\n## Transactions\n\n';
      formatted += '```json\n';

      // Handle both string (new format) and string[] (old format)
      if (typeof qciData.transactions === 'string') {
        // New format: direct string containing JSON
        try {
          const parsed = JSON.parse(qciData.transactions);
          // If it's already an array of transaction groups, use it directly
          if (Array.isArray(parsed)) {
            formatted += JSON.stringify(parsed, null, 2);
          } else {
            // Single transaction object, wrap in array
            formatted += JSON.stringify([parsed], null, 2);
          }
        } catch (error) {
          console.error('[ipfsService] Failed to parse transaction string:', error);
          // Fall back to empty array
          formatted += '[]';
        }
      } else if (Array.isArray(qciData.transactions) && qciData.transactions.length > 0) {
        // Old format: string array (legacy support)
        if (typeof qciData.transactions[0] === 'string') {
          try {
            const parsed = JSON.parse(qciData.transactions[0]);
            // If it's already an array of transaction groups, use it directly
            if (Array.isArray(parsed)) {
              formatted += JSON.stringify(parsed, null, 2);
            } else {
              // Single transaction object, wrap in array
              formatted += JSON.stringify([parsed], null, 2);
            }
          } catch (error) {
            console.error('[ipfsService] Failed to parse legacy transaction string:', error);
            // Fall back to empty array
            formatted += '[]';
          }
        } else {
          // Convert all transactions to proper JSON format (legacy/fallback path)
          const jsonTransactions = qciData.transactions.map(tx => {
            if (typeof tx === 'string') {
              // Try to parse if it's already JSON
              try {
                return JSON.parse(tx);
              } catch {
                // Legacy format or plain string, skip for now
                return null;
              }
            } else if (typeof tx === 'object') {
              return tx;
            }
            return null;
          }).filter(tx => tx !== null);

          // Format as JSON array
          formatted += JSON.stringify(jsonTransactions, null, 2);
        }
      } else {
        // Empty or invalid, use empty array
        formatted += '[]';
      }

      formatted += '\n```\n';
    }

    return formatted;
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
   * Fetch and parse QCI from IPFS
   */
  async fetchQCI(cidOrUrl: string): Promise<string> {
    // Extract CID from URL if needed
    const cid = cidOrUrl.startsWith("ipfs://") ? cidOrUrl.slice(7) : cidOrUrl;

    const rawContent = await this.provider.fetch(cid);
    const processed = this.processIPFSContent(rawContent, cid);

    return processed;
  }

  /**
   * Convert JSON QCI structure to markdown format
   */
  private formatQCIFromJSON(data: any): string {
    // Extract content if it exists
    const content = data.content || "";
    
    // Build frontmatter from the JSON data
    const frontmatter = [
      `qci: ${data.qci || "unknown"}`,
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
   * Fetch multiple QCIs concurrently using provider's optimized method if available
   */
  async fetchMultipleQCIs(cids: string[]): Promise<Map<string, string>> {
    // Use provider's optimized fetchMultiple if available
    if (this.provider.fetchMultiple) {
      console.debug(`[IPFSService] Using provider's optimized fetchMultiple for ${cids.length} CIDs`);
      const results = await this.provider.fetchMultiple(cids);
      
      // Process each result to handle JSON unwrapping (same logic as fetchQCI but without fetching)
      const processedResults = new Map<string, string>();
      for (const [cid, rawContent] of results) {
        try {
          // Apply the same JSON unwrapping logic as fetchQCI
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
        const content = await this.fetchQCI(cid);
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
        // Case 1: Full QCI JSON structure (has qci, title, etc. - check this first)
        if ("qci" in parsed || "title" in parsed) {
          // Convert the JSON structure to markdown format
          const frontmatter = [
            `qci: ${parsed.qci || "unknown"}`,
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
          return parsed.content;
        }

        // Case 3: Simple JSON with just 'content' field
        if ("content" in parsed && typeof parsed.content === "string") {
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
   * Upload pre-formatted QCI markdown content with metadata
   */
  async uploadQCI(
    markdownContent: string,
    _metadata?: {
      name?: string;
      qciNumber?: string;
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
   * Generate QCI markdown from frontmatter and content
   */
  generateQCIMarkdown(frontmatter: Record<string, any>, content: string): string {
    const frontmatterLines = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");

    return `---\n${frontmatterLines}\n---\n\n${content}`;
  }

  /**
   * Parse QCI markdown to extract frontmatter and content
   */
  parseQCIMarkdown(markdown: string | any): {
    frontmatter: Record<string, any>;
    content: string;
  } {

    // Ensure we have a string to work with
    if (typeof markdown !== "string") {
      console.error("parseQCIMarkdown received non-string:", typeof markdown, markdown);
      // Try to handle JSON objects that might have been passed directly
      if (typeof markdown === "object" && markdown !== null) {
        // If it's already a parsed QCI object, convert it to markdown first
        if ("qci" in markdown || "title" in markdown) {
          const obj = markdown as any;
          const frontmatter = [
            `qci: ${obj.qci || "unknown"}`,
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
          throw new Error("Invalid QCI format: expected string content or QCI object");
        }
      } else {
        throw new Error("Invalid QCI format: expected string content");
      }
    }

    // Trim whitespace
    markdown = markdown.trim();

    if (!markdown) {
      throw new Error("Invalid QCI format: empty content");
    }

    // Check for frontmatter
    const match = markdown.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);

    if (!match) {
      // Log the first 200 chars for debugging
      console.error("Failed to parse QCI markdown. First 200 chars:", markdown.substring(0, 200));
      throw new Error('Invalid QCI format: missing frontmatter. Content must start with "---" delimiter');
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
   * Verify QCI content matches hash
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
      // Use the provider's gateway
      const gateway = this.provider.gateway || getIPFSGateway();
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
    const content = await this.fetchQCI(cidOrUrl);
    return JSON.parse(content);
  }
}