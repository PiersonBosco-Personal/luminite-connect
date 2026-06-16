#!/usr/bin/env node
// Installed into a target repo at .claude/hooks/luminite-hook.mjs and invoked
// by Claude Code's SessionStart and Stop hooks. Zero dependencies.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

async function stop() {
  // No code-comment scraping. Just remind Claude to keep task state current.
  process.stdout.write(
    "Luminite: if a task changed state this turn, update it now — " +
    "move it to In Progress when you start, complete it when you finish.\n",
  );
}

async function main() {
  const cmd = process.argv[2];
  const cfg = config();
  if (!cfg.token || !cfg.mcpUrl) return; // not connected — stay silent
  if (cmd === "session-start") await sessionStart(cfg);
  else if (cmd === "stop") await stop();
}

// Only run when executed directly (not when imported by the test suite).
if (process.argv[1] && process.argv[1].endsWith("luminite-hook.mjs")) {
  main().catch(() => process.exit(0)); // never break the user's session on a hook error
}
