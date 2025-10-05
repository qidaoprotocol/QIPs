import { useReadContracts, useAccount } from "wagmi";
import { formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { config } from "../config";

const TOKEN_CONTRACT_ADDRESS = "0x1bffabc6dfcafb4177046db6686e3f135e8bc732" as const;
const REQUIRED_BALANCE = 150000;
const ERC20_ABI = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Global hook to check QI token balance for Snapshot submissions
 * Only runs in production mode (when using qidao.eth space)
 * Shared across all components via WAGMI's built-in cache
 * Always checks balance on Ethereum mainnet regardless of connected network
 */
export function useQITokenBalance() {
  const { address } = useAccount();

  // Determine if we need to check token balance based on Snapshot space
  const isTestMode = config.snapshotTestMode;
  const isDefaultSpace = config.snapshotSpace === "qidao.eth" && !isTestMode;
  const requiresTokenBalance = isDefaultSpace;

  const { data, isLoading } = useReadContracts({
    contracts: [
      {
        address: TOKEN_CONTRACT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        chainId: mainnet.id,
      },
      {
        address: TOKEN_CONTRACT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "decimals",
        chainId: mainnet.id,
      },
    ],
    query: {
      enabled: !!address && requiresTokenBalance,
      staleTime: 30_000, // 30 seconds
      refetchInterval: 60_000, // Refetch every 60 seconds
    },
  });

  // Extract balance and decimals from multicall results
  const balance = data?.[0]?.status === "success" ? data[0].result : undefined;
  const decimals = data?.[1]?.status === "success" ? data[1].result : undefined;

  const tokenBalance =
    balance !== undefined && decimals !== undefined
      ? Number(formatUnits(balance, decimals))
      : requiresTokenBalance
      ? 0
      : REQUIRED_BALANCE;

  return {
    tokenBalance,
    isLoading,
    requiresTokenBalance,
    requiredBalance: REQUIRED_BALANCE,
    hasRequiredBalance: tokenBalance >= REQUIRED_BALANCE,
  };
}
