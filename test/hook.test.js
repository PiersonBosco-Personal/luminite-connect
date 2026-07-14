import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTranscriptTurn,
  nothingInProgress,
  shouldBlock,
  completionNeedsSummary,
} from "../src/templates/luminite-hook.mjs";

const userPrompt = (t) => JSON.stringify({ type: "user", message: { role: "user", content: t } });
const assistantTool = (name) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name }] } });
const toolResult = () =>
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });

test("parseTranscriptTurn: file mutation, no luminite write → mutated, not synced", () => {
  const jsonl = [userPrompt("fix the bug"), assistantTool("Edit"), toolResult()].join("\n");
  assert.deepEqual(parseTranscriptTurn(jsonl), { mutated: true, synced: false });
});

test("parseTranscriptTurn: tool_result entries do not reset the turn boundary", () => {
  const jsonl = [userPrompt("go"), assistantTool("Write"), toolResult(), assistantTool("Bash")].join("\n");
  assert.equal(parseTranscriptTurn(jsonl).mutated, true);
});

test("parseTranscriptTurn: a luminite write this turn counts as synced", () => {
  const jsonl = [userPrompt("start it"), assistantTool("mcp__luminite__update_task")].join("\n");
  assert.equal(parseTranscriptTurn(jsonl).synced, true);
});

test("parseTranscriptTurn: capturing a thread entry counts as synced", () => {
  const jsonl = [userPrompt("note the decision"), assistantTool("mcp__luminite__add_thread_entry")].join("\n");
  assert.equal(parseTranscriptTurn(jsonl).synced, true);
});

test("parseTranscriptTurn: only edits BEFORE the last prompt are ignored", () => {
  const jsonl = [assistantTool("Edit"), userPrompt("now just answer a question")].join("\n");
  assert.deepEqual(parseTranscriptTurn(jsonl), { mutated: false, synced: false });
});

test("parseTranscriptTurn: conversational turn → nothing", () => {
  const jsonl = [userPrompt("what does this do?")].join("\n");
  assert.deepEqual(parseTranscriptTurn(jsonl), { mutated: false, synced: false });
});

test("parseTranscriptTurn: malformed lines are skipped", () => {
  const jsonl = ["not json", userPrompt("go"), assistantTool("MultiEdit")].join("\n");
  assert.equal(parseTranscriptTurn(jsonl).mutated, true);
});

test("parseTranscriptTurn: no user prompt → scans all entries (boundary=-1 fallback)", () => {
  const jsonl = assistantTool("Edit"); // transcript with no user entry at all
  assert.deepEqual(parseTranscriptTurn(jsonl), { mutated: true, synced: false });
});

test("parseTranscriptTurn: parallel Edit + luminite write in one entry → mutated and synced", () => {
  const entry = JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", name: "Edit" },
        { type: "tool_use", name: "mcp__luminite__update_task" },
      ],
    },
  });
  const jsonl = [userPrompt("do both"), entry].join("\n");
  assert.deepEqual(parseTranscriptTurn(jsonl), { mutated: true, synced: true });
});

test("nothingInProgress: 'No tasks match' → true, 'Tasks (n)' → false", () => {
  assert.equal(nothingInProgress("No tasks match the given filters."), true);
  assert.equal(nothingInProgress("Tasks (2):\n- #1 ..."), false);
  assert.equal(nothingInProgress(""), false);
});

test("shouldBlock: blocks only when mutated, not synced, nothing in progress, no active loop", () => {
  const base = { stopHookActive: false, mutated: true, synced: false, inProgressText: "No tasks match." };
  assert.equal(shouldBlock(base), true);
  assert.equal(shouldBlock({ ...base, stopHookActive: true }), false);
  assert.equal(shouldBlock({ ...base, mutated: false }), false);
  assert.equal(shouldBlock({ ...base, synced: true }), false);
  assert.equal(shouldBlock({ ...base, inProgressText: "Tasks (1):" }), false);
});

const completeTask = (input) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
    { type: "tool_use", name: "mcp__luminite__complete_task", input },
  ] } });

test("completionNeedsSummary: complete_task with no summary → true", () => {
  const jsonl = [userPrompt("finish it"), completeTask({ task_id: 5 })].join("\n");
  assert.equal(completionNeedsSummary(jsonl), true);
});

test("completionNeedsSummary: complete_task with blank summary → true", () => {
  const jsonl = [userPrompt("done"), completeTask({ task_id: 5, summary: "   " })].join("\n");
  assert.equal(completionNeedsSummary(jsonl), true);
});

test("completionNeedsSummary: complete_task WITH summary → false", () => {
  const jsonl = [userPrompt("done"), completeTask({ task_id: 5, summary: "rewired auth" })].join("\n");
  assert.equal(completionNeedsSummary(jsonl), false);
});

test("completionNeedsSummary: no complete_task this turn → false", () => {
  const jsonl = [userPrompt("hi"), assistantTool("Edit")].join("\n");
  assert.equal(completionNeedsSummary(jsonl), false);
});

test("completionNeedsSummary: only completions BEFORE the last prompt are ignored", () => {
  const jsonl = [completeTask({ task_id: 1 }), userPrompt("now answer a question")].join("\n");
  assert.equal(completionNeedsSummary(jsonl), false);
});
