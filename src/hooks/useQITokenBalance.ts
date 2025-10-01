import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, formatUnits } from "viem";
import { mainnet } from "viem/chains";
import { useEthersSigner } from "../utils/ethers";
import { config } from "../config";

const TOKEN_CONTRACT_ADDRESS = "0x1bffabc6dfcafb4177046db6686e3f135e8bc732";
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

// Create a dedicated Ethereum mainnet client for token balance checks
const mainnetClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

/**
 * Global hook to check QI token balance for Snapshot submissions
 * Only runs in production mode (when using qidao.eth space)
 * Shared across all components via React Query cache
 * Always checks balance on Ethereum mainnet regardless of connected network
 */
export function useQITokenBalance() {
  const signer = useEthersSigner();

  // Determine if we need to check token balance based on Snapshot space
  const isTestMode = config.snapshotTestMode;
  const isDefaultSpace = config.snapshotSpace === "qidao.eth" && !isTestMode;
  const requiresTokenBalance = isDefaultSpace;

  const fetchTokenBalance = async () => {
    if (!signer || !requiresTokenBalance) return REQUIRED_BALANCE; // Return valid balance for non-default spaces

    const address = await signer.getAddress();

    const [balance, decimals] = await Promise.all([
      mainnetClient.readContract({
        address: TOKEN_CONTRACT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }),
      mainnetClient.readContract({
        address: TOKEN_CONTRACT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);

    return Number(formatUnits(balance, decimals));
  };

  const query = useQuery({
    queryKey: ["tokenBalance", TOKEN_CONTRACT_ADDRESS, signer ? "connected" : "disconnected", requiresTokenBalance],
    queryFn: fetchTokenBalance,
    enabled: !!signer,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every 60 seconds
  });

  return {
    tokenBalance: query.data ?? (requiresTokenBalance ? 0 : REQUIRED_BALANCE),
    isLoading: query.isLoading,
    requiresTokenBalance,
    requiredBalance: REQUIRED_BALANCE,
    hasRequiredBalance: (query.data ?? 0) >= REQUIRED_BALANCE,
  };
}
