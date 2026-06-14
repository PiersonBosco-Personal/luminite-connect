import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMcpJson, mergeSettingsLocal, ensureGitignored, writeConfig } from "../src/config.js";
import { configPaths } from "../src/paths.js";

test("mergeMcpJson adds the luminite server, preserving others", () => {
  const prev = { mcpServers: { other: { type: "http", url: "x" } } };
  const next = mergeMcpJson(prev, "https://api.luminiteapp.com/api/mcp");
  assert.deepEqual(next.mcpServers.other, { type: "http", url: "x" });
  assert.equal(next.mcpServers.luminite.url, "https://api.luminiteapp.com/api/mcp");
  assert.equal(next.mcpServers.luminite.headers.Authorization, "Bearer ${LUMINITE_TOKEN}");
});

test("mergeSettingsLocal sets token env + hooks without clobbering existing keys", () => {
  const prev = { env: { OTHER: "1" }, permissions: { allow: ["Bash"] } };
  const next = mergeSettingsLocal(prev, "tok-123");
  assert.equal(next.env.OTHER, "1");
  assert.equal(next.env.LUMINITE_TOKEN, "tok-123");
  assert.deepEqual(next.permissions, { allow: ["Bash"] }); // untouched — installer never edits permissions
  const stop = next.hooks.Stop[0].hooks[0].command;
  // Regression: the command must address the hook via $CLAUDE_PROJECT_DIR so it
  // resolves regardless of (a) which nested repo Claude runs the hook from and
  // (b) symlink/container boundaries where a baked host-absolute path would not
  // exist inside the sandbox. Quoted so a space in the resolved path is safe.
  assert.equal(stop, 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/luminite-hook.mjs" stop');
  assert.match(next.hooks.SessionStart[0].hooks[0].command, /session-start$/);
});

test("ensureGitignored appends only missing entries", () => {
  const out = ensureGitignored("node_modules\n.claude/settings.local.json\n", [
    ".claude/settings.local.json",
    ".claude/luminite-connect.json",
  ]);
  assert.equal((out.match(/luminite-connect\.json/g) || []).length, 1);
  assert.match(out, /node_modules/);
});

test("mergeSettingsLocal preserves foreign hooks and does not duplicate the luminite hook", () => {
  const prev = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "echo my-own-hook" }] }],
      SessionStart: [
        { hooks: [{ type: "command", command: "node .claude/hooks/luminite-hook.mjs session-start" }] },
      ],
    },
  };
  const next = mergeSettingsLocal(prev, "tok");
  // foreign Stop hook kept, luminite Stop appended after it
  assert.equal(next.hooks.Stop.length, 2);
  assert.match(next.hooks.Stop[0].hooks[0].command, /echo my-own-hook/);
  assert.match(next.hooks.Stop[1].hooks[0].command, /CLAUDE_PROJECT_DIR\/\.claude\/hooks\/luminite-hook\.mjs" stop/);
  // prior luminite SessionStart (relative path) replaced, NOT duplicated
  assert.equal(next.hooks.SessionStart.length, 1);
  assert.match(next.hooks.SessionStart[0].hooks[0].command, /session-start/);
});

test("writeConfig persists state with BOTH api_url and mcp_url", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-"));
  try {
    const paths = configPaths(root);
    writeConfig(paths, {
      mcpUrl: "https://api.luminiteapp.com/api/mcp",
      apiUrl: "https://api.luminiteapp.com/api",
      rawToken: "tok-xyz",
      tokenId: 7,
      projectId: 3,
    });
    const state = JSON.parse(readFileSync(paths.state, "utf8"));
    assert.equal(state.api_url, "https://api.luminiteapp.com/api");
    assert.equal(state.mcp_url, "https://api.luminiteapp.com/api/mcp");
    assert.equal(state.token_id, 7);
    assert.equal(state.project_id, 3);
    const mcp = JSON.parse(readFileSync(paths.mcpJson, "utf8"));
    assert.equal(mcp.mcpServers.luminite.url, "https://api.luminiteapp.com/api/mcp");
    // The Stop hook command addresses the helper via $CLAUDE_PROJECT_DIR — not a
    // CWD-relative path and not a baked host-absolute path — so it resolves from
    // any working directory and across symlink/container boundaries.
    const settings = JSON.parse(readFileSync(paths.settingsLocal, "utf8"));
    assert.equal(
      settings.hooks.Stop[0].hooks[0].command,
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/luminite-hook.mjs" stop',
    );
    const gi = readFileSync(paths.gitignore, "utf8");
    assert.match(gi, /\.claude\/luminite-connect\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
