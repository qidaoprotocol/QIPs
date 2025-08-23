import { useState } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { QIPClient, QIPStatus } from '../services/qipClient';
import { toast } from 'react-hot-toast';
import type { Hash } from 'viem';

interface UpdateQIPStatusResult {
  updateStatus: (qipNumber: bigint, newStatus: QIPStatus) => Promise<Hash | undefined>;
  isUpdating: boolean;
  error: Error | null;
  transactionHash: Hash | null;
}

export function useUpdateQIPStatus(): UpdateQIPStatusResult {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hash | null>(null);

  const updateStatus = async (qipNumber: bigint, newStatus: QIPStatus): Promise<Hash | undefined> => {
    if (!walletClient || !address) {
      const errorMsg = 'Please connect your wallet to update QIP status';
      toast.error(errorMsg);
      setError(new Error(errorMsg));
      return undefined;
    }

    setIsUpdating(true);
    setError(null);
    setTransactionHash(null);

    try {
      // Get QIP client instance
      const contractAddress = import.meta.env.VITE_QIP_REGISTRY_ADDRESS;
      const rpcUrl = import.meta.env.VITE_BASE_RPC_URL;
      const useTestnet = import.meta.env.VITE_USE_TESTNET === 'true';
      
      if (!contractAddress) {
        throw new Error('QIP Registry contract address not configured');
      }

      const qipClient = new QIPClient(contractAddress as `0x${string}`, rpcUrl, useTestnet);

      // Update the status on-chain
      console.log(`Updating QIP ${qipNumber} status to ${QIPStatus[newStatus]}`);
      const hash = await qipClient.updateQIPStatus(walletClient, qipNumber, newStatus);
      
      setTransactionHash(hash);
      
      // Wait for transaction confirmation
      console.log('Waiting for transaction confirmation...');
      const publicClient = walletClient.chain ? 
        await import('viem').then(m => m.createPublicClient({
          chain: walletClient.chain,
          transport: m.http(import.meta.env.VITE_BASE_RPC_URL)
        })) : null;
      
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ 
          hash,
          confirmations: 1 
        });
        console.log('Transaction confirmed');
      }
      
      toast.success('QIP status updated successfully');
      return hash;
    } catch (err: any) {
      console.error('Failed to update QIP status:', err);
      
      // Parse error message for user-friendly display
      let errorMessage = 'Failed to update QIP status';
      
      if (err.message?.includes('AccessControl')) {
        errorMessage = 'You do not have permission to update this QIP status';
      } else if (err.message?.includes('InvalidTransition')) {
        errorMessage = 'Invalid status transition';
      } else if (err.message?.includes('QIPNotFound')) {
        errorMessage = 'QIP not found';
      } else if (err.message?.includes('user rejected')) {
        errorMessage = 'Transaction cancelled by user';
      } else if (err.details) {
        errorMessage = err.details;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(new Error(errorMessage));
      toast.error(errorMessage);
      return undefined;
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    updateStatus,
    isUpdating,
    error,
    transactionHash
  };
}