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

/**
 * The state file keeps flat top-level fields describing the ACTIVE connection
 * (mcp_url/api_url/token_id — the hook and idempotency check read these) PLUS a
 * `profiles` map of saved connections and an `active` pointer, so you can switch
 * environments (prod ↔ local) without re-editing files. Reading normalizes a
 * legacy flat state (no `profiles`) into a single profile named by `active` /
 * "prod", pulling the raw token from settings.local so old installs migrate.
 */
function normalizeState(paths) {
  const raw = readJson(paths.state, {}) || {};
  if (raw.profiles) return raw;
  if (raw.mcp_url) {
    const token = readJson(paths.settingsLocal, {})?.env?.LUMINITE_TOKEN ?? null;
    const name = raw.active ?? "prod";
    return {
      ...raw,
      active: name,
      profiles: {
        [name]: {
          token_id: raw.token_id,
          project_id: raw.project_id,
          api_url: raw.api_url,
          mcp_url: raw.mcp_url,
          project_name: raw.project_name ?? null,
          raw_token: token,
        },
      },
    };
  }
  return { active: null, profiles: {} };
}

function flatFor(name, prof) {
  return {
    token_id: prof.token_id,
    project_id: prof.project_id,
    api_url: prof.api_url,
    mcp_url: prof.mcp_url,
    project_name: prof.project_name ?? null,
    active: name,
  };
}

export function listProfiles(paths) {
  const s = normalizeState(paths);
  return { active: s.active ?? null, profiles: s.profiles || {} };
}

/**
 * Switch: point the live files (.mcp.json url + settings.local token) at the
 * saved `name` profile and mark it active. Returns the profile, or null if no
 * such profile exists. Does not touch CLAUDE.md/gitignore — those don't change
 * between environments.
 */
export function applyProfile(paths, name) {
  const s = normalizeState(paths);
  const prof = (s.profiles || {})[name];
  if (!prof) return null;
  writeJson(paths.mcpJson, mergeMcpJson(readJson(paths.mcpJson, {}), prof.mcp_url));
  writeJson(paths.settingsLocal, mergeSettingsLocal(readJson(paths.settingsLocal, {}), prof.raw_token));
  writeJson(paths.state, { ...flatFor(name, prof), profiles: s.profiles });
  return prof;
}

export function writeConfig(paths, { name = "prod", mcpUrl, rawToken, apiUrl, tokenId, projectId, projectName }) {
  if (!existsSync(paths.claudeDir)) mkdirSync(paths.claudeDir, { recursive: true });

  writeJson(paths.mcpJson, mergeMcpJson(readJson(paths.mcpJson, {}), mcpUrl));
  writeJson(paths.settingsLocal, mergeSettingsLocal(readJson(paths.settingsLocal, {}), rawToken));

  const profiles = { ...(normalizeState(paths).profiles || {}) };
  profiles[name] = {
    token_id: tokenId,
    project_id: projectId,
    api_url: apiUrl,
    mcp_url: mcpUrl,
    project_name: projectName ?? null,
    raw_token: rawToken,
  };
  writeJson(paths.state, { ...flatFor(name, profiles[name]), profiles });

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
