/**
 * Shared serializer for the Snapshot proposal `body` field.
 *
 * Single source of truth for both the wire payload (used by `SnapshotSubmitter`
 * at submission time) and the live character counter (used by the editor and
 * submitter UIs). Counter and gate call sites measure `formatProposalBody(...).length`
 * directly — `.length` (UTF-16 code units) is what the Snapshot Sequencer
 * itself checks (`msg.payload.body.length`), so this matches the server.
 *
 * Do NOT count UTF-8 bytes here. The comments backend in mai-api gates on
 * bytes (see `CommentComposer.tsx`), but Snapshot gates on `.length` —
 * this is a deliberate per-backend divergence.
 */
export function formatProposalBody(
  rawMarkdown: string,
  frontmatter: any,
  transactions?: string | string[]
): string {
  // Remove frontmatter from the beginning of the markdown
  let content = rawMarkdown.replace(/^---[\s\S]*?---\n?/, "").trim();

  // Remove title if it appears at the beginning of the content
  // This handles various title formats like "## QIP247 Title" or "## **QIP247 Title**"
  content = content.replace(/^##\s*\*?\*?QIP\d+[:\s].*?\*?\*?\n+/i, "");

  // Build YAML frontmatter for the proposal body
  const yamlFields = [];
  yamlFields.push("---");

  // Use "network" instead of "chain"
  if (frontmatter.chain) {
    yamlFields.push(`network: ${frontmatter.chain}`);
  }

  if (frontmatter.author) {
    yamlFields.push(`author: ${frontmatter.author}`);
  }

  // Only include implementor if it's not "None"
  if (frontmatter.implementor && frontmatter.implementor !== "None") {
    yamlFields.push(`implementor: ${frontmatter.implementor}`);
  }

  // Only include implementation-date if it's not "None"
  if (frontmatter["implementation-date"] && frontmatter["implementation-date"] !== "None") {
    yamlFields.push(`implementation-date: ${frontmatter["implementation-date"]}`);
  }

  if (frontmatter.created) {
    yamlFields.push(`created: ${frontmatter.created}`);
  }

  yamlFields.push("---");

  // Build the full body with YAML frontmatter
  let fullBody = yamlFields.join("\n") + "\n\n" + content;

  // Add transactions if present - now supporting multisig-grouped format
  if (transactions) {
    fullBody += "\n\n## Transactions\n\n";

    try {
      let parsed: any;

      // Handle both string (new) and string[] (old) formats
      if (typeof transactions === "string") {
        // New format: direct string
        parsed = JSON.parse(transactions);
      } else if (Array.isArray(transactions) && transactions.length > 0) {
        // Old format: string array
        parsed = JSON.parse(transactions[0]);
      } else {
        // Invalid format
        parsed = [];
      }

      // Check if it's the new multisig-grouped format
      if (Array.isArray(parsed) && parsed.length > 0 && "multisig" in parsed[0] && "transactions" in parsed[0]) {
        // New format: group by multisig
        parsed.forEach((group: any, groupIndex: number) => {
          if (group.multisig) {
            fullBody += `### Multisig: \`${group.multisig}\`\n\n`;
          }

          group.transactions.forEach((tx: any, txIndex: number) => {
            const txNum = groupIndex > 0 ? `${groupIndex + 1}.${txIndex + 1}` : `${txIndex + 1}`;
            fullBody += `**Transaction ${txNum}**`;

            // Add annotation if present
            if (tx.annotation) {
              fullBody += `\n\n*${tx.annotation}*`;
            }

            fullBody += `\n\n\`\`\`json\n${JSON.stringify(tx, null, 2)}\n\`\`\`\n\n`;
          });
        });
      } else if (Array.isArray(parsed)) {
        // Legacy format: simple array of transactions
        parsed.forEach((tx: any, index: number) => {
          fullBody += `### Transaction ${index + 1}\n\`\`\`json\n${JSON.stringify(tx, null, 2)}\n\`\`\`\n\n`;
        });
      }
    } catch (error) {
      // Fallback: treat as legacy format string array
      if (Array.isArray(transactions)) {
        transactions.forEach((tx, index) => {
          fullBody += `### Transaction ${index + 1}\n\`\`\`\n${tx}\n\`\`\`\n\n`;
        });
      }
    }
  }

  return fullBody;
}
