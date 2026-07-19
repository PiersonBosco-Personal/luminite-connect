#!/usr/bin/env node
// Installed into a target repo at .claude/hooks/luminite-hook.mjs and invoked
// by Claude Code's SessionStart and Stop hooks. Zero dependencies.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
  "mcp__luminite__add_thread_entry",
]);

// ── git-commit heartbeat: pure helpers (exported for tests) ──────────────────

/** Decide what to do with a repo given its stored cursor and current HEAD. */
export function nextAction(lastSha, headSha) {
  if (!lastSha) return "seed";          // first run — record HEAD, harvest nothing
  if (lastSha === headSha) return "skip"; // no new commits
  return "harvest";
}

const MAX_COMMIT_CONTENT = 500;

/**
 * Parse `git log --format=%H%x1f%s%x1f%b%x1e` output (fields \x1f-delimited,
 * records \x1e-delimited, newest-first) into [{ sha, content }] ordered
 * OLDEST-first so a consumer can advance a cursor monotonically. Content is the
 * subject, plus the body when present, capped at MAX_COMMIT_CONTENT chars.
 */
export function parseCommitLog(stdout) {
  const out = [];
  for (const record of String(stdout).split("\x1e")) {
    const r = record.trim();
    if (!r) continue;
    const [sha = "", subject = "", body = ""] = r.split("\x1f");
    const s = subject.trim();
    const b = body.trim();
    let content = b ? `${s}\n\n${b}` : s;
    if (content.length > MAX_COMMIT_CONTENT) content = content.slice(0, MAX_COMMIT_CONTENT) + "…";
    out.push({ sha: sha.trim(), content });
  }
  return out.reverse(); // git log is newest-first → return oldest-first
}

/**
 * The cursor sha after harvesting: unchanged if nothing was written, else the
 * sha of the last commit we reached the server for (written or refused;
 * commits are oldest-first). A network failure mid-batch leaves the cursor at
 * the last success — next Stop retries the rest, so no entry is lost and none
 * is duplicated.
 * ponytail: the -n cap upstream means a >5-commit burst drops the oldest; that
 * loss is intentional and bounded, and session-end wrap-up is the safety net.
 */
export function cursorAfter(commits, succeeded, lastSha) {
  if (succeeded <= 0) return lastSha;
  return commits[succeeded - 1].sha;
}

export const BLOCK_REASON =
  "You changed code this turn but no Luminite task is In Progress. Move the task " +
  "you're working on to In Progress with update_task (infer it from the open tasks; " +
  "ask if ambiguous). If no task applies to this change, say so and finish.";

export const SUMMARY_REASON =
  "You completed a task this turn without a 'what changed' summary. Call complete_task " +
  "again for that task with summary (what actually changed, 1-2 sentences) and rationale " +
  "(why it made sense) so your teammate can follow the change in the team changelog.";

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
 * True when the current turn contains a complete_task call whose `summary`
 * input is missing or blank. Reuses the same last-user-prompt boundary as
 * parseTranscriptTurn. Over-counts (never under-counts) when no prompt is found.
 */
export function completionNeedsSummary(jsonlText) {
  const entries = [];
  for (const line of String(jsonlText).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { entries.push(JSON.parse(t)); } catch { /* skip */ }
  }

  let boundary = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i]?.message;
    if (m?.role === "user") {
      const c = m.content;
      const isPrompt = typeof c === "string"
        ? c.trim() !== ""
        : Array.isArray(c) && c.some((x) => x?.type === "text") && !c.some((x) => x?.type === "tool_result");
      if (isPrompt) { boundary = i; break; }
    }
  }

  for (let i = boundary + 1; i < entries.length; i++) {
    const content = entries[i]?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use" && block.name === "mcp__luminite__complete_task") {
        const summary = block.input?.summary;
        if (typeof summary !== "string" || summary.trim() === "") return true;
      }
    }
  }
  return false;
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
  const installRoot = join(claudeDir, "..");
  const watchRepos = Array.isArray(state.watch_repos) && state.watch_repos.length
    ? state.watch_repos
    : ["."];
  const cursorPath = join(claudeDir, "luminite-thread-cursor.json");
  return { apiUrl: state.api_url, token, mcpUrl, installRoot, watchRepos, cursorPath };
}

async function rpc(mcpUrl, token, method, params) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ac.signal,
    });
    return res.json();
  } finally {
    clearTimeout(t);
  }
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 5000 }).trim();
}

/**
 * Harvest new commits from each watched repo into the Thread as momentum/commit
 * entries. Best-effort: any git or network failure is swallowed so the hook can
 * never trap the session. Cursor advances only past successfully-written commits.
 */
async function harvestCommits(cfg) {
  const cursor = existsSync(cfg.cursorPath)
    ? (safeParse(readFileSync(cfg.cursorPath, "utf8")) ?? {})
    : {};
  // ponytail: cursor persists per-repo, so a crash mid-repo can re-send that
  // repo's <=5-commit batch (dup entries) next Stop; acceptable at this
  // cardinality, tighten to per-commit if dup entries show up.
  const save = () => writeFileSync(cfg.cursorPath, JSON.stringify(cursor, null, 2) + "\n");

  for (const rel of cfg.watchRepos) {
    const repo = join(cfg.installRoot, rel);
    let head;
    try {
      git(repo, ["rev-parse", "--git-dir"]); // throws if not a git repo
      head = git(repo, ["rev-parse", "HEAD"]); // throws if no commits yet
    } catch {
      continue;
    }

    const last = cursor[rel];
    const action = nextAction(last, head);
    if (action === "skip") continue;
    if (action === "seed") { cursor[rel] = head; save(); continue; }

    // action === "harvest": read up to 5 newest non-merge commits since `last`.
    let logOut;
    try {
      logOut = git(repo, ["log", "--no-merges", "-n", "5", "--format=%H%x1f%s%x1f%b%x1e", `${last}..HEAD`]);
    } catch {
      // `last` sha is gone (rebase/reset rewrote history) → reseed, never replay.
      cursor[rel] = head; save(); continue;
    }

    const commits = parseCommitLog(logOut);
    let consumed = 0;
    for (const c of commits) {
      try {
        await rpc(cfg.mcpUrl, cfg.token, "tools/call", {
          name: "add_thread_entry",
          arguments: { type: "momentum", content: c.content, trigger: "commit" },
        });
      } catch {
        break; // couldn't reach the server (network/timeout) — stop; retry from the cursor next Stop
      }
      // Reached the server. Whether it stored the entry or deterministically
      // refused it, advance past this commit: a single poison-pill commit must
      // not permanently wedge harvesting of every later commit in this repo.
      // (A refused entry is dropped; session-end wrap-up is the safety net.)
      consumed++;
    }

    const newCursor = cursorAfter(commits, consumed, last);
    if (newCursor !== last) { cursor[rel] = newCursor; save(); }
  }
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
  // Resolve on EOF normally; fall back after 3s so a stdin that never closes
  // can never trap the hook (the for-await form would hang indefinitely, and
  // the main().catch backstop does not rescue a non-resolving iterator).
  return new Promise((resolve) => {
    let data = "";
    const t = setTimeout(() => resolve(data), 3000);
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function stop(cfg) {
  // Git-commit heartbeat: harvest new commits into the Thread. Independent of the
  // task-tracking gate below, and cursor-guarded so re-invocation is idempotent.
  try { await harvestCommits(cfg); } catch { /* never trap the session on a hook error */ }

  // Claude Code passes { transcript_path, stop_hook_active, cwd, ... } on stdin.
  const input = safeParse(await readStdin()) ?? {};

  // Loop safety: if we already blocked this stop cycle, never re-block.
  if (input.stop_hook_active) return;

  const tp = input.transcript_path;
  if (!tp || !existsSync(tp)) return; // can't inspect the turn → fail open

  const transcript = readFileSync(tp, "utf8");

  // Summary nudge: a task was completed this turn without a "what changed" summary.
  if (completionNeedsSummary(transcript)) {
    process.stdout.write(JSON.stringify({ decision: "block", reason: SUMMARY_REASON }) + "\n");
    return; // one nudge per stop cycle
  }

  const { mutated, synced } = parseTranscriptTurn(transcript);
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
