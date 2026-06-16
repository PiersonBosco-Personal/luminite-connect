import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mergeClaudeMd } from "./claudemd.js";

export function mergeMcpJson(prev, mcpUrl) {
  const next = prev && typeof prev === "object" ? { ...prev } : {};
  next.mcpServers = { ...(next.mcpServers || {}) };
  next.mcpServers.luminite = {
    type: "http",
    url: mcpUrl,
    headers: { Authorization: "Bearer ${LUMINITE_TOKEN}" },
  };
  return next;
}

/**
 * Replace (not append-duplicate) the Luminite hook group for one event while
 * preserving any hook groups the user defined themselves. Idempotent across
 * re-runs: a prior Luminite group is dropped and re-added, foreign groups stay.
 */
function withLuminiteHook(groups, command) {
  const foreign = (Array.isArray(groups) ? groups : []).filter(
    (g) => !g?.hooks?.some((h) => typeof h?.command === "string" && h.command.includes("luminite-hook.mjs")),
  );
  return [...foreign, { hooks: [{ type: "command", command }] }];
}

export function mergeSettingsLocal(prev, rawToken) {
  const next = prev && typeof prev === "object" ? { ...prev } : {};
  next.env = { ...(next.env || {}), LUMINITE_TOKEN: rawToken };
  next.hooks = { ...(next.hooks || {}) };
  // $CLAUDE_PROJECT_DIR — set by Claude Code to the project root (its launch dir)
  // when it runs a hook, resolved in Claude's OWN filesystem namespace. We use it
  // instead of a baked path because neither alternative survives both real-world
  // setups:
  //   • A CWD-relative path breaks when Claude runs the hook from the git repo of
  //     the edited file, which may be a NESTED repo, not the install dir.
  //   • A host-absolute path baked at install time breaks across a symlink /
  //     container boundary — e.g. Claude running in a dockerized sandbox where the
  //     host path "/Users/…/.claude/hooks/luminite-hook.mjs" does not exist.
  // $CLAUDE_PROJECT_DIR resolves correctly in both cases. The hook helper always
  // lives at <root>/.claude/hooks/luminite-hook.mjs, so the project-relative tail
  // is constant. Quoted so spaces in the resolved path are safe.
  const helper = '"$CLAUDE_PROJECT_DIR/.claude/hooks/luminite-hook.mjs"';
  next.hooks.SessionStart = withLuminiteHook(next.hooks.SessionStart, `node ${helper} session-start`);
  next.hooks.Stop = withLuminiteHook(next.hooks.Stop, `node ${helper} stop`);
  // NOTE: permissions are intentionally never touched here.
  return next;
}

export function ensureGitignored(content, entries) {
  const lines = new Set(content.split("\n").map((l) => l.trim()));
  let out = content.endsWith("\n") || content === "" ? content : content + "\n";
  for (const e of entries) {
    if (!lines.has(e)) out += `${e}\n`;
  }
  return out;
}

// ── IO wrappers ──────────────────────────────────────────────────────────────

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function writeConfig(paths, { mcpUrl, rawToken, apiUrl, tokenId, projectId }) {
  if (!existsSync(paths.claudeDir)) mkdirSync(paths.claudeDir, { recursive: true });

  writeJson(paths.mcpJson, mergeMcpJson(readJson(paths.mcpJson, {}), mcpUrl));
  writeJson(paths.settingsLocal, mergeSettingsLocal(readJson(paths.settingsLocal, {}), rawToken));
  writeJson(paths.state, { token_id: tokenId, project_id: projectId, api_url: apiUrl, mcp_url: mcpUrl });

  const gi = existsSync(paths.gitignore) ? readFileSync(paths.gitignore, "utf8") : "";
  writeFileSync(
    paths.gitignore,
    ensureGitignored(gi, [".claude/settings.local.json", ".claude/luminite-connect.json"]),
  );

  // CLAUDE.md is intentionally NOT gitignored: the block is meant to be
  // committed and shared with the team. Idempotent via markers on re-run.
  const prevClaude = existsSync(paths.claudeMd) ? readFileSync(paths.claudeMd, "utf8") : "";
  writeFileSync(paths.claudeMd, mergeClaudeMd(prevClaude));
}
