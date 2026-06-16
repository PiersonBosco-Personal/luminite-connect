const START = "<!-- LUMINITE:START -->";
const END = "<!-- LUMINITE:END -->";

// The stable cross-tool workflow rule. Lives at CLAUDE.md priority (highest),
// so it does NOT restate per-tool details — those live in each MCP tool's own
// description and grow there automatically.
export const LUMINITE_BLOCK = `${START}
## Luminite project sync

This project is tracked in Luminite via the \`luminite\` MCP server. Keep it in sync as you work — without being asked, and without waiting for the end of the session:

- **Starting a task** → call \`update_task\` to move it to In Progress.
- **Finishing a task** → call \`complete_task\`.
- **Making a notable decision** (architecture, tradeoff, scope change) → call \`create_note\`, linked with \`task_id\`.
- **Unsure which task applies** → ask, don't guess.

The full set of Luminite tools and when to use each is described in the MCP tool list itself — consult it rather than assuming. If you're missing project state, call \`get_session_context\` first.
${END}`;

/**
 * Merge the Luminite block into a CLAUDE.md body, idempotently.
 *   • markers present  → replace what's between them in place
 *   • no markers, has content → append, blank-line separated
 *   • empty/missing    → just the block
 */
export function mergeClaudeMd(prev, block = LUMINITE_BLOCK) {
  const content = typeof prev === "string" ? prev : "";

  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return content.slice(0, startIdx) + block + content.slice(endIdx + END.length);
  }

  if (content.trim() === "") return block + "\n";

  const base = content.endsWith("\n") ? content : content + "\n";
  return base + "\n" + block + "\n";
}
