import React, { useState, useEffect } from "react";
import { useEthersSigner } from "../utils/ethers";
import { createProposal, getProposals } from "../utils/snapshot-client";
import { Proposal } from "@snapshot-labs/snapshot.js/dist/src/sign/types";
import { ethers } from "ethers";
import { useQuery } from "@tanstack/react-query";

interface SnapshotSubmitterProps {
  frontmatter: any;
  html: string;
}

const SnapshotSubmitter: React.FC<SnapshotSubmitterProps> = ({ frontmatter, html }) => {
  const signer = useEthersSigner();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<React.ReactNode>(null);
  const [highestQip, setHighestQip] = useState<number | null>(null);

  const stripHtml = (html: string) => {
    if (typeof window === "undefined") return "";
    const tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  };

  const { data: proposals, isLoading: loadingProposals } = useQuery({
    queryKey: ["proposals", "qidao.eth"],
    queryFn: () => getProposals("qidao.eth"),
  });

  useEffect(() => {
    if (proposals) {
      const qipNumbers = proposals.map((p: any) => {
        const match = p.title.match(/QIP(\d+)/i);
        return match ? parseInt(match[1], 10) : 0;
      });
      console.log("qipNumbers", qipNumbers);
      setHighestQip(Math.max(0, ...qipNumbers));
    }
  }, [proposals]);

  const TOKEN_CONTRACT_ADDRESS = "0x1bffabc6dfcafb4177046db6686e3f135e8bc732";
  const REQUIRED_BALANCE = 150000;
  const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"];

  const fetchTokenBalance = async () => {
    if (!signer) return 0;
    const tokenContract = new ethers.Contract(TOKEN_CONTRACT_ADDRESS, ERC20_ABI, signer);
    const address = await signer.getAddress();
    const [balance, decimals] = await Promise.all([tokenContract.balanceOf(address), tokenContract.decimals()]);
    return Number(ethers.utils.formatUnits(balance, decimals));
  };

  const { data: tokenBalance = 0, isLoading: checkingBalance } = useQuery({
    queryKey: ["tokenBalance", TOKEN_CONTRACT_ADDRESS, signer ? "connected" : "disconnected"],
    queryFn: fetchTokenBalance,
    enabled: !!signer,
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const isQipValid = highestQip !== null && frontmatter.qip === highestQip + 1;

  let startTime: number;
  let endTime: number;

  const createdTime = Math.floor(Date.now() / 1000);
  const startOffset = 86400; // Exactly 1 day
  const endOffset = 345600; // Exactly 4 days

  startTime = createdTime + startOffset;
  endTime = createdTime + endOffset;

  console.log("Created time (now):", createdTime);
  console.log("Start time:", startTime, `(+${startOffset}s = ${startOffset / 3600}h)`);
  console.log("End time:", endTime, `(+${endOffset}s = ${endOffset / 86400}d)`);
  console.log("Voting period:", endTime - startTime, "seconds =", (endTime - startTime) / 86400, "days");

  const proposalOptions: Proposal = {
    space: "qidao.eth",
    type: "single-choice",
    title: frontmatter.title,
    body: `QIP #${frontmatter.qip}: ${frontmatter.title}\n\n${stripHtml(html)}`,
    choices: ["Yes", "No", "Abstain"],
    start: startTime,
    end: endTime,
    snapshot: 0,
    discussion: "",
    plugins: JSON.stringify({}),
  };

  const handleSubmit = async () => {
    if (!signer) {
      setStatus("Please connect your wallet first.");
      return;
    }
    if (!isQipValid) {
      setStatus(`Error: Invalid QIP number. The next QIP should be #${highestQip === null ? "..." : highestQip + 1}.`);
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const receipt = await createProposal(signer, "https://hub.snapshot.org", proposalOptions);
      if (receipt && (receipt as any).id) {
        const proposalId = (receipt as any).id;
        const proposalUrl = `https://snapshot.org/#/qidao.eth/proposal/${proposalId}`;
        setStatus(
          <span>
            Proposal created successfully!
            <a href={proposalUrl} target="_blank" rel="noopener noreferrer" className="ml-2 underline hover:no-underline">
              View proposal →
            </a>
          </span>
        );
      } else {
        setStatus(`Proposal created: ${JSON.stringify(receipt)}`);
      }
    } catch (e: any) {
      console.error("Snapshot submission error:", e);
      if (e.error && e.error_description) {
        setStatus(`Error: ${e.error_description}`);
      } else if (e.code === "ACTION_REJECTED" || e.code === 4001) {
        setStatus("Transaction cancelled by user");
      } else {
        setStatus(`Error: ${e.message || "Failed to create proposal. Please try again."}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex flex-col items-center">
        {status && (
          <p
            className={`mt-2 text-sm ${
              typeof status === "string" && (status.includes("Error") || status.includes("failed") || status.includes("cancelled"))
                ? "text-red-600 font-medium"
                : "text-green-600 font-medium"
            }`}
          >
            {status}
          </p>
        )}
        {signer && tokenBalance >= REQUIRED_BALANCE && (
          <p className="mt-1 text-xs text-gray-600">Token balance: {tokenBalance.toLocaleString()} (✓ meets requirement)</p>
        )}
      </div>

      <div className="flex justify-center sm:m-0 m-3">
        <button
          className={`m-auto w-fit px-6 py-3 rounded-lg font-medium transition-colors ${
            !signer || tokenBalance < REQUIRED_BALANCE || loading || checkingBalance || !isQipValid || loadingProposals
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          } text-white`}
          onClick={handleSubmit}
          disabled={!signer || tokenBalance < REQUIRED_BALANCE || loading || checkingBalance || !isQipValid || loadingProposals}
        >
          {loading
            ? "Submitting..."
            : checkingBalance || loadingProposals
            ? "Checking prerequisites..."
            : !signer
            ? "Connect Wallet"
            : !isQipValid
            ? `Invalid QIP Number (currently ${frontmatter.qip}, next is ${highestQip === null ? "..." : highestQip + 1})`
            : tokenBalance < REQUIRED_BALANCE
            ? `Insufficient Balance (${tokenBalance.toLocaleString()} / ${REQUIRED_BALANCE.toLocaleString()} required)`
            : "Submit to Snapshot"}
        </button>
      </div>

      {status && (
        <p
          className={`text-center text-sm ${
            typeof status === "string" && (status.includes("Error") || status.includes("failed") || status.includes("cancelled"))
              ? "text-red-600 font-medium"
              : "text-green-600 font-medium"
          }`}
        >
          {status}
        </p>
      )}
    </>
  );
};

export default SnapshotSubmitter;
