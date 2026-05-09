// src/utils/ethers.ts
//
// Wallet-client → ethers Signer bridge for the SnapshotSubmitter flow.
// snapshot.js's signing path expects an ethers Signer; useEthersSigner is
// the seam. The reverse direction (publicClient → ethers Provider) was
// previously also exported but had zero callers and bypassed the new RPC
// pool/observability machinery — those exports were removed in the RPC
// robustness migration. The current file is intentionally signer-only.
import { providers } from "ethers";
import { useWalletClient } from "wagmi";
import type { WalletClient } from "viem";
import React from "react";

export function walletClientToSigner(client: WalletClient) {
  const { chain, transport, account } = client;
  if (!chain) {
    throw new Error("Chain is not defined");
  }
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  // Use ethers.providers.Web3Provider to wrap the transport
  const ethersProvider = new providers.Web3Provider(
    // @ts-ignore: transport.value is EIP-1193 provider (e.g. window.ethereum)
    transport.value || (window as any).ethereum,
    network
  );
  return ethersProvider.getSigner(account?.address);
}

// Hook: use ethers Signer from wagmi WalletClient
export function useEthersSigner({ chainId }: { chainId?: number } = {}) {
  const { data: walletClient } = useWalletClient({ chainId });
  return React.useMemo(() => (walletClient ? walletClientToSigner(walletClient) : undefined), [walletClient]);
}
