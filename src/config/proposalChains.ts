export interface ProposalChain {
  /** Canonical display name */
  name: string;
  /** EVM chain ID */
  chainId: number;
  /** Backward-compat names for IPFS-stored data */
  aliases: string[];
  /** Block explorer base URL (for linking to addresses/txs) */
  explorerUrl: string;
  /** Etherscan-compatible API URL (undefined = no API, manual ABI paste only) */
  explorerApiUrl?: string;
}

export const PROPOSAL_CHAINS: ProposalChain[] = [
  { name: "Ethereum",       chainId: 1,     aliases: [],                           explorerUrl: "https://etherscan.io",               explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Base",           chainId: 8453,  aliases: [],                           explorerUrl: "https://basescan.org",               explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Polygon PoS",    chainId: 137,   aliases: ["Polygon", "Matic"],         explorerUrl: "https://polygonscan.com",            explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Linea",          chainId: 59144, aliases: [],                           explorerUrl: "https://lineascan.build",            explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "BNB",            chainId: 56,    aliases: ["BSC", "Binance"],           explorerUrl: "https://bscscan.com",                explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Metis",          chainId: 1088,  aliases: [],                           explorerUrl: "https://andromeda-explorer.metis.io", explorerApiUrl: "https://api.routescan.io/v2/network/mainnet/evm/1088/etherscan/api" },
  { name: "Optimism",       chainId: 10,    aliases: [],                           explorerUrl: "https://optimistic.etherscan.io",    explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Arbitrum",       chainId: 42161, aliases: [],                           explorerUrl: "https://arbiscan.io",                explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Avalanche",      chainId: 43114, aliases: [],                           explorerUrl: "https://snowtrace.io",               explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Fraxtal",        chainId: 252,   aliases: [],                           explorerUrl: "https://fraxscan.com",               explorerApiUrl: "https://api.fraxscan.com/api" },
  { name: "Polygon zkEVM",  chainId: 1101,  aliases: [],                           explorerUrl: "https://zkevm.polygonscan.com",      explorerApiUrl: "https://api-zkevm.polygonscan.com/api" },
  { name: "Gnosis",         chainId: 100,   aliases: ["xDai", "Gnosis Chain"],     explorerUrl: "https://gnosisscan.io",              explorerApiUrl: "https://api.etherscan.io/v2/api" },
  { name: "Kava",           chainId: 2222,  aliases: [],                           explorerUrl: "https://kavascan.com",               explorerApiUrl: undefined },
];

// Build lookup indexes
const _byName = new Map<string, ProposalChain>();
const _byId = new Map<number, ProposalChain>();

for (const chain of PROPOSAL_CHAINS) {
  _byName.set(chain.name.toLowerCase(), chain);
  for (const alias of chain.aliases) {
    _byName.set(alias.toLowerCase(), chain);
  }
  _byId.set(chain.chainId, chain);
}

/** Look up a chain by canonical name or alias (case-insensitive) */
export function getChainByName(name: string): ProposalChain | undefined {
  return _byName.get(name.toLowerCase());
}

/** Look up a chain by EVM chain ID */
export function getChainById(chainId: number): ProposalChain | undefined {
  return _byId.get(chainId);
}

/** Get all canonical chain names (for dropdown options) */
export function getAllChainNames(): string[] {
  return PROPOSAL_CHAINS.map(c => c.name);
}

/** Get block explorer address URL for a chain */
export function getExplorerAddressUrl(chainName: string, address: string): string | null {
  const chain = getChainByName(chainName);
  if (!chain) return null;
  return `${chain.explorerUrl}/address/${address}`;
}
