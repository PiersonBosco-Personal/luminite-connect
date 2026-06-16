import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscriptTurn, nothingInProgress, shouldBlock } from "../src/templates/luminite-hook.mjs";

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
