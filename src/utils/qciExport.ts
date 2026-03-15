import { QCIExportData } from "@/services/qciClient";
import { type QCIData } from "../hooks/useQCIData";
import { toast } from "sonner";
import { getAllChainNames } from "../config/proposalChains";

export interface QCIExportJSON {
  metadata: {
    exportedAt: string;
    contractAddress: string;
    chain: string;
    exportVersion: string;
  };
  qci: {
    qciNumber: number;
    title: string;
    chain: string;
    status: string;
    statusId?: string;
    author: string;
    implementor: string;
    implementationDate: string;
    snapshotProposalId: string;
    created: string;
    lastUpdated: string;
    version: number;
    ipfsUrl: string;
    contentHash: string;
    content: string;
  };
  versions?: Array<{
    version: number;
    contentHash: string;
    ipfsUrl: string;
    timestamp: string;
    changeNote: string;
  }>;
  transactions?: string[];
}

/**
 * Format QCI data as markdown with frontmatter
 */
export function formatQCIAsMarkdown(qciData: QCIData | null, includeMetadata: boolean = true): string {
  if (!qciData) return "";

  // Build frontmatter
  const frontmatter = [
    "---",
    `qci: ${qciData.qciNumber}`,
    `title: ${qciData.title}`,
    `chain: ${qciData.chain}`,
    `status: ${qciData.status}`,
    `author: ${qciData.author}`,
    `implementor: ${qciData.implementor || "None"}`,
    `implementation-date: ${qciData.implementationDate || "None"}`,
    `proposal: ${qciData.proposal || "None"}`,
    `created: ${qciData.created}`,
  ];

  // Add optional metadata if requested
  if (includeMetadata) {
    frontmatter.push(`version: ${qciData.version || 1}`, `ipfs: ${qciData.ipfsUrl || ""}`);
  }

  frontmatter.push("---", "");

  // Combine frontmatter with content
  let markdown = frontmatter.join("\n") + (qciData.content || "");

  // Add export metadata as comments if requested
  if (includeMetadata) {
    const exportDate = new Date().toISOString();
    markdown += "\n\n";
    markdown += "<!-- Export Metadata -->\n";
    markdown += `<!-- Exported from QCI Registry at ${exportDate} -->\n`;
    if (qciData.version && qciData.version > 1) {
      markdown += `<!-- Version ${qciData.version} -->\n`;
    }
  }

  return markdown;
}

/**
 * Format QCI data as JSON export
 */
export function formatQCIAsJSON(
  qciData: QCIData | null,
  exportData?: QCIExportData | null,
  contractAddress?: string
): QCIExportJSON | null {
  if (!qciData) return null;

  const exportJSON: QCIExportJSON = {
    metadata: {
      exportedAt: new Date().toISOString(),
      contractAddress: contractAddress || "",
      chain: "Base",
      exportVersion: "1.0",
    },
    qci: {
      qciNumber: qciData.qciNumber,
      title: qciData.title,
      chain: qciData.chain,
      status: qciData.status,
      author: qciData.author,
      implementor: qciData.implementor || "None",
      implementationDate: qciData.implementationDate || "None",
      snapshotProposalId: qciData.proposal || "None",
      created: qciData.created,
      lastUpdated: new Date(qciData.lastUpdated || Date.now()).toISOString(),
      version: qciData.version || 1,
      ipfsUrl: qciData.ipfsUrl || "",
      contentHash: qciData.contentHash || "",
      content: qciData.content || "",
    },
  };

  // Add version history if available from export data
  if (exportData && exportData.versions.length > 0) {
    exportJSON.versions = exportData.versions.map((v, index) => ({
      version: index + 1,
      contentHash: v.contentHash,
      ipfsUrl: v.ipfsUrl,
      timestamp: new Date(Number(v.timestamp) * 1000).toISOString(),
      changeNote: v.changeNote,
    }));
  }

  return exportJSON;
}

/**
 * Trigger file download
 */
export function downloadFile(content: string, filename: string, mimeType: string = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard with toast notification
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!", {
      duration: 2000,
      position: "bottom-right",
    });
    return true;
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
    toast.error("Failed to copy to clipboard", {
      duration: 3000,
      position: "bottom-right",
    });
    return false;
  }
}

/**
 * Validate imported JSON data
 */
export function validateImportData(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check if it's an object
  if (typeof data !== "object" || data === null) {
    errors.push("Invalid data format: expected JSON object");
    return { valid: false, errors };
  }

  // Check for required QCI fields
  const qci = data.qci;
  if (!qci) {
    errors.push("Missing required field: qci");
    return { valid: false, errors };
  }

  // Validate required QCI fields
  const requiredFields = ["title", "chain", "content"];
  for (const field of requiredFields) {
    if (!qci[field]) {
      errors.push(`Missing required QCI field: ${field}`);
    }
  }

  // Validate chain value against registry
  const validChains = getAllChainNames();
  if (qci.chain && !validChains.includes(qci.chain)) {
    errors.push(`Invalid chain: ${qci.chain}. Must be one of: ${validChains.join(", ")}`);
  }

  // Validate status if provided
  if (qci.status) {
    const validStatuses = ["Draft", "Ready for Snapshot", "Posted to Snapshot"];
    if (!validStatuses.includes(qci.status)) {
      errors.push(`Invalid status: ${qci.status}. Must be one of: ${validStatuses.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Convert imported JSON to format expected by ProposalEditor
 */
export function convertImportToEditorFormat(importData: QCIExportJSON): {
  title: string;
  chain: string;
  content: string;
  implementor: string;
  qciNumber?: number;
} {
  const qci = importData.qci;

  return {
    title: qci.title,
    chain: qci.chain,
    content: qci.content,
    implementor: qci.implementor !== "None" ? qci.implementor : "",
    qciNumber: qci.qciNumber,
  };
}

/**
 * Generate a comprehensive QCI archive filename
 */
export function generateExportFilename(qciNumber: number, format: "md" | "json" | "archive", version?: number): string {
  const date = new Date().toISOString().split("T")[0];
  const versionStr = version && version > 1 ? `-v${version}` : "";

  switch (format) {
    case "md":
      return `QCI-${qciNumber}${versionStr}-${date}.md`;
    case "json":
      return `QCI-${qciNumber}${versionStr}-export-${date}.json`;
    case "archive":
      return `QCI-${qciNumber}-archive-${date}.zip`;
    default:
      return `QCI-${qciNumber}-${date}.txt`;
  }
}
