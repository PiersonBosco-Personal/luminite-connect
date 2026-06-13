import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const HELPER = ".claude/hooks/luminite-hook.mjs";

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

export function mergeSettingsLocal(prev, rawToken) {
  const next = prev && typeof prev === "object" ? { ...prev } : {};
  next.env = { ...(next.env || {}), LUMINITE_TOKEN: rawToken };
  next.hooks = { ...(next.hooks || {}) };
  next.hooks.SessionStart = [
    { hooks: [{ type: "command", command: `node ${HELPER} session-start` }] },
  ];
  next.hooks.Stop = [
    { hooks: [{ type: "command", command: `node ${HELPER} stop` }] },
  ];
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
}
