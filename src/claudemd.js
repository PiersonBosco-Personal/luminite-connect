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
- **Recording a decision, a ruled-out dead-end, or where you left off** → call \`add_thread_entry\` (the project memory that's replayed to you next session).
- **Unsure which task applies** → ask, don't guess.

The full set of Luminite tools and when to use each is described in the MCP tool list itself — consult it rather than assuming. If you're missing project state, call \`get_session_context\` first.
${END}`;

/**
 * Merge the Luminite block into a CLAUDE.md body, idempotently.
 * The block is always placed at the very TOP of the file so it sits at the
 * highest priority, ahead of whatever else the team keeps in CLAUDE.md.
 *   • markers present  → strip the old block, re-prepend at the top
 *   • no markers, has content → prepend, blank-line separated
 *   • empty/missing    → just the block
 */
export function mergeClaudeMd(prev, block = LUMINITE_BLOCK) {
  const content = typeof prev === "string" ? prev : "";

  // Strip any existing Luminite block (wherever it currently sits) so we can
  // re-place it at the top. A partial/orphaned marker is left in place and gets
  // cleaned up once a complete START…END pair exists on a later run.
  let rest = content;
  const startIdx = content.indexOf(START);
  const endIdx = content.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    rest = content.slice(0, startIdx) + content.slice(endIdx + END.length);
  }

  rest = rest.replace(/^\s+/, "");
  if (rest === "") return block + "\n";

  return block + "\n\n" + rest;
}
