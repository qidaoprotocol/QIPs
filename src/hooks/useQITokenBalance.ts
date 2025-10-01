import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import { useEthersSigner } from "../utils/ethers";
import { config } from "../config";

const TOKEN_CONTRACT_ADDRESS = "0x1bffabc6dfcafb4177046db6686e3f135e8bc732";
const REQUIRED_BALANCE = 150000;
const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];

/**
 * Global hook to check QI token balance for Snapshot submissions
 * Only runs in production mode (when using qidao.eth space)
 * Shared across all components via React Query cache
 */
export function useQITokenBalance() {
  const signer = useEthersSigner();

  // Determine if we need to check token balance based on Snapshot space
  const isTestMode = config.snapshotTestMode;
  const isDefaultSpace = config.snapshotSpace === "qidao.eth" && !isTestMode;
  const requiresTokenBalance = isDefaultSpace;

  const fetchTokenBalance = async () => {
    if (!signer || !requiresTokenBalance) return REQUIRED_BALANCE; // Return valid balance for non-default spaces
    const tokenContract = new ethers.Contract(TOKEN_CONTRACT_ADDRESS, ERC20_ABI, signer);
    const address = await signer.getAddress();
    const [balance, decimals] = await Promise.all([tokenContract.balanceOf(address), tokenContract.decimals()]);
    return Number(ethers.utils.formatUnits(balance, decimals));
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
