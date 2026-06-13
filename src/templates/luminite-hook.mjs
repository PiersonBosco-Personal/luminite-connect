#!/usr/bin/env node
// Installed into a target repo at .claude/hooks/luminite-hook.mjs and invoked
// by Claude Code's SessionStart and Stop hooks. Zero dependencies.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const MARKER = /(?:\/\/|\/\*|#)\s*(TODO|FIXME)\b[:\s]*(.+?)\s*(?:\*\/)?\s*$/;

/** Pure: pull TODO/FIXME comments out of one file's text. */
export function extractTodos(file, content) {
  const todos = [];
  const lines = content.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER);
    if (!m) continue;
    const text = m[2].trim();
    if (!text) continue;
    todos.push({ text, file, line: i + 1, priority: m[1] === "FIXME" ? "high" : "medium" });
  }
  return todos;
}

/** Pure: assemble the sync_todos payload from changed files. */
export function buildSyncPayload(files, readFile) {
  const todos = [];
  for (const f of files) {
    const content = readFile(f);
    if (content != null) todos.push(...extractTodos(f, content));
  }
  return { files, todos };
}

// ── runtime wiring (skipped when imported by tests) ──────────────────────────

function config() {
  const statePath = join(process.cwd(), ".claude", "luminite-connect.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
  let token = process.env.LUMINITE_TOKEN;
  if (!token) {
    const sp = join(process.cwd(), ".claude", "settings.local.json");
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

function changedFiles() {
  try {
    const tracked = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
    return [...tracked.split("\n"), ...untracked.split("\n")].map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function sessionStart({ mcpUrl, token }) {
  const out = await rpc(mcpUrl, token, "tools/call", { name: "get_session_context", arguments: {} });
  const text = out?.result?.content?.[0]?.text ?? "";
  // stdout from a SessionStart hook is injected into Claude's context.
  process.stdout.write(text + "\n\n");
  process.stdout.write(
    "Proactively keep Luminite in sync while you work, without being asked: " +
      "move a task to In Progress with update_task when you start it, complete_task when you finish, " +
      "and create_note (linked via task_id) when you make a notable decision. " +
      "Infer the current task from the open tasks above; ask if it is ambiguous.\n",
  );
}

async function stop({ mcpUrl, token }) {
  const files = changedFiles();
  if (files.length === 0) return;
  const payload = buildSyncPayload(files, (f) => {
    const p = join(process.cwd(), f);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  });
  const out = await rpc(mcpUrl, token, "tools/call", { name: "sync_todos", arguments: payload });
  const summary = out?.result?.content?.[0]?.text;
  if (summary) {
    process.stdout.write(`Luminite: ${summary}. If a task changed state this turn, update it now.\n`);
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
