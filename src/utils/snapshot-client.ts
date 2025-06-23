import snapshot from "@snapshot-labs/snapshot.js";
import { Proposal } from "@snapshot-labs/snapshot.js/dist/src/sign/types";
import { providers, Signer } from "ethers";

export function getSnapshotClient(hub: string) {
  return new snapshot.Client712(hub);
}

// Create a proposal using ethers.Signer
export async function createProposal(signer: Signer, hub: string, options: Proposal) {
  const client = getSnapshotClient(hub);
  if (!options.snapshot) {
    options.snapshot = (await signer.provider?.getBlockNumber()) || 0;
  }
  const proposal: Proposal = {
    space: options.space,
    type: options.type,
    title: options.title,
    body: options.body,
    choices: options.choices,
    start: options.start,
    end: options.end,
    snapshot: options.snapshot,
    discussion: options.discussion || "",
    plugins: options.plugins || "",
    app: options.app || "snapshot",
  };

  // Only add timestamp if explicitly provided
  if (options.timestamp !== undefined) {
    proposal.timestamp = options.timestamp;
  }

  if (!signer.provider) {
    throw new Error("Signer must have a provider to create a proposal.");
  }

  const receipt = await client.proposal(signer.provider as providers.Web3Provider, await signer.getAddress(), proposal);
  return receipt;
}

export async function getProposals(space: string) {
  const query = `query Proposals {
      proposals(
        first: 100
        skip: 0
        where: {
          space_in: ["${space}"]
        }
        orderBy: "created"
        orderDirection: desc
      ) {
        id
        title
      }
    }
  `;
  const url = "https://hub.snapshot.org/graphql";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("response", data);

    if (data.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
    }

    return data.data.proposals;
  } catch (error) {
    console.error("Error fetching proposals:", error);
    return [];
  }
}
