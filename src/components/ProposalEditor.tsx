import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';
import { type Address } from 'viem';
import { QIPClient, QIPStatus, type QIPContent } from '../services/qipClient';
import { getIPFSService } from '../services/getIPFSService';
import { IPFSService } from '../services/ipfsService';
import { config } from '../config/env';

interface ProposalEditorProps {
  registryAddress: Address;
  rpcUrl?: string;
  existingQIP?: {
    qipNumber: bigint;
    content: QIPContent;
  };
}

const NETWORKS = ['Polygon', 'Ethereum', 'Base', 'Metis', 'Arbitrum', 'Optimism', 'BSC', 'Avalanche'];

export const ProposalEditor: React.FC<ProposalEditorProps> = ({ 
  registryAddress, 
  rpcUrl,
  existingQIP 
}) => {
  const { address, isConnected, chain, status } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();
  
  // Debug logging
  console.log("🔍 ProposalEditor Debug:");
  console.log("- registryAddress:", registryAddress);
  console.log("- Wallet Connection Status:", status);
  console.log("- isConnected:", isConnected);
  console.log("- address:", address);
  console.log("- chain:", chain);
  console.log("- walletClient:", walletClient ? "✅ Available" : "❌ Not available");
  
  // Debug environment variables directly
  console.log("🔍 Direct Env Vars Check:");
  // @ts-ignore
  console.log("- VITE_USE_MAI_API:", import.meta.env?.VITE_USE_MAI_API);
  // @ts-ignore
  console.log("- VITE_IPFS_API_URL:", import.meta.env?.VITE_IPFS_API_URL);
  // @ts-ignore
  console.log("- VITE_USE_LOCAL_IPFS:", import.meta.env?.VITE_USE_LOCAL_IPFS);
  
  // Check if we need to switch chains
  const isWrongChain = chain && chain.id !== 8453;
  
  const handleSwitchChain = async () => {
    try {
      await switchChain({ chainId: 8453 });
    } catch (error) {
      console.error("Failed to switch chain:", error);
    }
  };
  
  // Form state
  const [title, setTitle] = useState(existingQIP?.content.title || '');
  const [network, setNetwork] = useState(existingQIP?.content.network || 'Polygon');
  const [content, setContent] = useState(existingQIP?.content.content || '');
  const [implementor, setImplementor] = useState(existingQIP?.content.implementor || 'None');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  
  // Services
  const [qipClient, setQipClient] = useState<QIPClient | null>(null);
  const [ipfsService, setIpfsService] = useState<IPFSService | null>(null);
  const queryClient = useQueryClient();

  // Debug saving state changes
  useEffect(() => {
    console.log("🔍 Saving state changed:", saving);
  }, [saving]);

  // Add a safety timeout to clear saving state if it gets stuck
  useEffect(() => {
    if (saving) {
      const timeout = setTimeout(() => {
        console.warn("⚠️ Saving state stuck for 30 seconds, forcing clear");
        setSaving(false);
        if (!success && !error) {
          setError("Operation timed out. Please check if your transaction was successful.");
        }
      }, 30000); // 30 second timeout

      return () => clearTimeout(timeout);
    }
  }, [saving, success, error]);

  useEffect(() => {
    if (registryAddress) {
      console.log("🔧 Initializing QIPClient with RPC:", rpcUrl || config.baseRpcUrl);
      const client = new QIPClient(registryAddress, rpcUrl || config.baseRpcUrl);
      setQipClient(client);
    }

    // Use centralized IPFS service selection
    try {
      const service = getIPFSService();
      setIpfsService(service);
      console.log("✅ IPFS service initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize IPFS service:", error);
      // Service will remain null, and the component will show the error state
    }
  }, [registryAddress, walletClient, rpcUrl]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      console.log("📝 Form submission started");

      if (!qipClient || !ipfsService || !address || !walletClient) {
        setError("Please connect your wallet");
        console.error("❌ Missing required services:", { qipClient: !!qipClient, ipfsService: !!ipfsService, address });
        return;
      }

      setError(null);
      setSuccess(null);
      setSaving(true);
      console.log("🔄 Saving state set to true");

      try {
        // Create QIP content object
        const qipContent: QIPContent = {
          qip: existingQIP?.qipNumber ? Number(existingQIP.qipNumber) : 0, // Will be assigned by contract
          title,
          network,
          status: "Draft",
          author: address,
          implementor,
          "implementation-date": "None",
          proposal: "None",
          created: new Date().toISOString().split("T")[0],
          content,
        };

        // Format the full content for IPFS
        const fullContent = ipfsService.formatQIPContent(qipContent);
        
        // Step 1: Pre-calculate IPFS CID without uploading
        console.log("🔮 Calculating IPFS CID...");
        const expectedCID = await ipfsService.calculateCID(fullContent);
        const expectedIpfsUrl = `ipfs://${expectedCID}`;
        console.log("✅ Expected CID:", expectedCID);
        
        // Step 2: Calculate content hash for blockchain
        const contentHash = ipfsService.calculateContentHash(qipContent);

        let qipNumber: bigint;
        let txHash: string;
        
        if (existingQIP) {
          // Update existing QIP
          console.log("📝 Updating QIP on blockchain...");
          txHash = await qipClient.updateQIP(
            walletClient,
            existingQIP.qipNumber,
            title,
            contentHash,
            expectedIpfsUrl,
            "Updated via web interface"
          );
          qipNumber = existingQIP.qipNumber;
          console.log("✅ Blockchain update successful:", txHash);
        } else {
          // Create new QIP
          console.log("🚀 Creating new QIP on blockchain...");
          const result = await qipClient.createQIP(walletClient, title, network, contentHash, expectedIpfsUrl);
          txHash = result.hash;
          qipNumber = result.qipNumber;
          console.log("✅ QIP created on blockchain:", { txHash, qipNumber });
        }
        
        // Step 3: Upload to IPFS with proper metadata AFTER blockchain confirmation
        console.log("📤 Uploading to IPFS with metadata...");
        const actualCID = await ipfsService.provider.upload(fullContent, {
          qipNumber: qipNumber > 0 ? qipNumber.toString() : 'pending',
          groupId: config.pinataGroupId
        });
        
        // Verify CIDs match
        if (actualCID !== expectedCID) {
          console.warn("⚠️ CID mismatch! Expected:", expectedCID, "Actual:", actualCID);
          // In production, you might want to handle this more gracefully
        } else {
          console.log("✅ IPFS upload successful, CID matches:", actualCID);
        }
        
        // Set success message
        if (existingQIP) {
          setSuccess(`QIP-${qipNumber} updated successfully! Transaction: ${txHash}`);
        } else if (qipNumber > 0) {
          setSuccess(`QIP-${qipNumber} created successfully! Transaction: ${txHash}`);
        } else {
          setSuccess(
            `QIP submitted successfully! Transaction: ${txHash}\n\nNote: The QIP number will be available once the transaction is confirmed.`
          );
        }
        
        // Invalidate list to refresh AllProposals
        queryClient.invalidateQueries({ queryKey: ["qips"] });

        // Reset form for new QIP
        console.log("🔄 Resetting form...");
        setTitle("");
        setContent("");
        setImplementor("None");
        console.log("✅ Form reset complete");
      } catch (err: any) {
        console.error("❌ Error saving QIP:", err);

        // Provide more helpful error messages
        let errorMessage = err.message || "Failed to save QIP";

        if (errorMessage.includes("Content already exists")) {
          errorMessage = "A QIP with identical content already exists. Please modify your proposal content to make it unique.";
        }

        setError(errorMessage);
      } finally {
        console.log("🔄 Setting saving state to false in finally block");
        setSaving(false);
        console.log("✅ Saving state set to false");
      }
    },
    [qipClient, ipfsService, address, walletClient, title, network, content, implementor, existingQIP]
  );

  const handlePreview = () => {
    setPreview(!preview);
  };

  if (!isConnected) {
    return (
      <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
        Please connect your wallet to create or edit QIPs
      </div>
    );
  }
  
  if (!registryAddress) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        Error: Registry address not configured. Please restart Gatsby to load environment variables.
      </div>
    );
  }
  
  if (!ipfsService) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
        Error: IPFS provider not configured. Please check your environment configuration.
      </div>
    );
  }
  
  if (isWrongChain) {
    return (
      <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded">
        <p className="mb-2">Please switch to Local Base Fork network (Chain ID: 8453)</p>
        <button 
          onClick={handleSwitchChain}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Switch to Local Base Fork
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6">
        {existingQIP ? `Edit QIP-${existingQIP.qipNumber}` : 'Create New QIP'}
      </h2>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700">
            Title *
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="Improve QiDAO Collateral Framework"
          />
        </div>

        <div>
          <label htmlFor="network" className="block text-sm font-medium text-gray-700">
            Network *
          </label>
          <select
            id="network"
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          >
            {NETWORKS.map(net => (
              <option key={net} value={net}>{net}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="implementor" className="block text-sm font-medium text-gray-700">
            Implementor
          </label>
          <input
            type="text"
            id="implementor"
            value={implementor}
            onChange={(e) => setImplementor(e.target.value)}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            placeholder="Dev team, DAO, or None"
          />
        </div>

        <div>
          <label htmlFor="content" className="block text-sm font-medium text-gray-700">
            Proposal Content (Markdown) *
          </label>
          <div className="mt-1">
            <textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
              rows={20}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-sm"
              placeholder={`## Summary

Brief overview of your proposal...

## Abstract

Detailed explanation...

## Rationale

Why this proposal is needed...

## Technical Specification

Implementation details...`}
            />
          </div>
        </div>

        <div className="flex space-x-4">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {saving ? 'Saving...' : existingQIP ? 'Update QIP' : 'Create QIP'}
          </button>

          <button
            type="button"
            onClick={handlePreview}
            className="inline-flex justify-center rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
      </form>

      {preview && (
        <div className="mt-8 border-t pt-8">
          <h3 className="text-xl font-bold mb-4">Preview</h3>
          <div className="bg-gray-50 p-6 rounded-lg">
            <h1 className="text-2xl font-bold mb-2">{title || 'Untitled'}</h1>
            <div className="text-sm text-gray-600 mb-4">
              <span>Network: {network}</span> • 
              <span> Author: {address}</span> • 
              <span> Status: Draft</span>
            </div>
            <div 
              className="prose max-w-none"
              dangerouslySetInnerHTML={{ 
                __html: content.replace(/\n/g, '<br />') 
              }} 
            />
          </div>
        </div>
      )}
    </div>
  );
};