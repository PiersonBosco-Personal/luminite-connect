#!/usr/bin/env node
// Installed into a target repo at .claude/hooks/luminite-hook.mjs and invoked
// by Claude Code's SessionStart and Stop hooks. Zero dependencies.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── pure decision helpers (exported for tests; safe to import) ───────────────

export const FILE_MUTATION_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
export const LUMINITE_WRITE_TOOLS = new Set([
  "mcp__luminite__create_task",
  "mcp__luminite__update_task",
  "mcp__luminite__complete_task",
  "mcp__luminite__create_note",
  "mcp__luminite__update_note",
]);

export const BLOCK_REASON =
  "You changed code this turn but no Luminite task is In Progress. Move the task " +
  "you're working on to In Progress with update_task (infer it from the open tasks; " +
  "ask if ambiguous). If no task applies to this change, say so and finish.";

function isUserPrompt(entry) {
  const msg = entry?.message;
  if (!msg || msg.role !== "user") return false;
  const content = msg.content;
  if (typeof content === "string") return content.trim() !== "";
  if (Array.isArray(content)) {
    // A genuine prompt carries a text block and no tool_result block.
    const hasToolResult = content.some((c) => c?.type === "tool_result");
    const hasText = content.some((c) => c?.type === "text");
    return hasText && !hasToolResult;
  }
  return false;
}

function toolUseNames(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((c) => c?.type === "tool_use" && typeof c.name === "string")
    .map((c) => c.name);
}

/**
 * Inspect the current turn (everything after the last genuine user prompt) and
 * report whether it mutated files and whether it already wrote to Luminite.
 */
export function parseTranscriptTurn(jsonlText) {
  const entries = [];
  for (const line of String(jsonlText).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      /* skip malformed line */
    }
  }

  // -1 means "no genuine user prompt found → scan the whole transcript". This
  // can over-count mutations (never under-count), the safer failure mode here.
  let boundary = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isUserPrompt(entries[i])) {
      boundary = i;
      break;
    }
  }

  let mutated = false;
  let synced = false;
  for (let i = boundary + 1; i < entries.length; i++) {
    for (const name of toolUseNames(entries[i])) {
      if (FILE_MUTATION_TOOLS.has(name)) mutated = true;
      if (LUMINITE_WRITE_TOOLS.has(name)) synced = true;
    }
  }
  return { mutated, synced };
}

/**
 * True when get_open_tasks{status:in_progress} reports an empty result.
 * NOTE: coupled to the get_open_tasks empty-result phrasing ("No tasks match").
 * A server-side copy change silently disables the gate (returns false → no block).
 */
export function nothingInProgress(probeText) {
  return typeof probeText === "string" && probeText.trimStart().startsWith("No tasks match");
}

/** The single source of truth for whether the Stop gate blocks. */
export function shouldBlock({ stopHookActive, mutated, synced, inProgressText }) {
  if (stopHookActive) return false;
  if (!mutated || synced) return false;
  return nothingInProgress(inProgressText);
}

// ── runtime wiring (skipped when imported by tests) ──────────────────────────

function config() {
  // This file lives at <root>/.claude/hooks/luminite-hook.mjs. Resolve config
  // relative to THIS file, not process.cwd(): Claude Code may run the hook with
  // its CWD set to a nested git repo rather than the directory it was installed
  // in, so process.cwd() can point at the wrong .claude/.
  const claudeDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const statePath = join(claudeDir, "luminite-connect.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  let token = process.env.LUMINITE_TOKEN;
  if (!token) {
    const sp = join(claudeDir, "settings.local.json");
    if (existsSync(sp)) token = JSON.parse(readFileSync(sp, "utf8"))?.env?.LUMINITE_TOKEN;
  }
  // Prefer the explicit mcp_url persisted by the installer; fall back to
  // deriving it from api_url for older state files.
  const mcpUrl = state.mcp_url || (state.api_url ? `${state.api_url}/mcp` : null);
  return { apiUrl: state.api_url, token, mcpUrl };
}

async function rpc(mcpUrl, token, method, params) {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

async function sessionStart({ mcpUrl, token }) {
  const out = await rpc(mcpUrl, token, "tools/call", { name: "get_session_context", arguments: {} });
  const text = out?.result?.content?.[0]?.text ?? "";
  // stdout from a SessionStart hook is injected into Claude's context.
  // The "keep in sync" instruction now lives in the installed CLAUDE.md block
  // (higher priority), so it is intentionally NOT repeated here.
  process.stdout.write(text + "\n\n");
}

async function readStdin() {
  if (process.stdin.isTTY) return ""; // no payload piped (e.g. manual run)
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function stop(cfg) {
  // Claude Code passes { transcript_path, stop_hook_active, cwd, ... } on stdin.
  const input = safeParse(await readStdin()) ?? {};

  // Loop safety: if we already blocked this stop cycle, never re-block.
  if (input.stop_hook_active) return;

  const tp = input.transcript_path;
  if (!tp || !existsSync(tp)) return; // can't inspect the turn → fail open

  const { mutated, synced } = parseTranscriptTurn(readFileSync(tp, "utf8"));
  if (!mutated || synced) return; // nothing to nudge — skip the network call

  // Code changed with no Luminite write this turn → ask what's In Progress.
  let inProgressText = "";
  try {
    const out = await rpc(cfg.mcpUrl, cfg.token, "tools/call", {
      name: "get_open_tasks",
      arguments: { status: "in_progress" },
    });
    inProgressText = out?.result?.content?.[0]?.text ?? "";
  } catch {
    return; // network/server error → fail open, never trap the session
  }

  if (shouldBlock({ stopHookActive: false, mutated, synced, inProgressText })) {
    // JSON on stdout with decision:block feeds `reason` back to Claude as an
    // instruction and prevents the turn from ending — exactly one nudge.
    process.stdout.write(JSON.stringify({ decision: "block", reason: BLOCK_REASON }) + "\n");
  }
}

async function main() {
  const cmd = process.argv[2];
  const cfg = config();
  if (!cfg.token || !cfg.mcpUrl) return; // not connected — stay silent
  if (cmd === "session-start") await sessionStart(cfg);
  else if (cmd === "stop") await stop(cfg);
}

// Only run when executed directly (not when imported by the test suite).
if (process.argv[1] && process.argv[1].endsWith("luminite-hook.mjs")) {
  main().catch(() => process.exit(0)); // never break the user's session on a hook error
}
