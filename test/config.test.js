import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMcpJson, mergeSettingsLocal, ensureGitignored, writeConfig, applyProfile, listProfiles, setProfile, discoverRepos } from "../src/config.js";
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

test("switching: save two profiles, `use` swaps token + mcp url in the live files", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-switch-"));
  try {
    const paths = configPaths(root);
    writeConfig(paths, { name: "prod", mcpUrl: "https://api.luminiteapp.com/api/mcp", apiUrl: "https://api.luminiteapp.com/api", rawToken: "prod-tok", tokenId: 1, projectId: 1, projectName: "P" });
    writeConfig(paths, { name: "local", mcpUrl: "http://localhost:8899/api/mcp", apiUrl: "http://localhost:8899/api", rawToken: "local-tok", tokenId: 2, projectId: 1, projectName: "P" });

    // After connecting local last, it is active; the live files reflect local.
    let mcp = JSON.parse(readFileSync(paths.mcpJson, "utf8"));
    let settings = JSON.parse(readFileSync(paths.settingsLocal, "utf8"));
    assert.equal(mcp.mcpServers.luminite.url, "http://localhost:8899/api/mcp");
    assert.equal(settings.env.LUMINITE_TOKEN, "local-tok");

    // Switch back to prod — both files flip together, no re-typing.
    const prof = applyProfile(paths, "prod");
    assert.equal(prof.raw_token, "prod-tok");
    mcp = JSON.parse(readFileSync(paths.mcpJson, "utf8"));
    settings = JSON.parse(readFileSync(paths.settingsLocal, "utf8"));
    assert.equal(mcp.mcpServers.luminite.url, "https://api.luminiteapp.com/api/mcp");
    assert.equal(settings.env.LUMINITE_TOKEN, "prod-tok");

    // Flat top-level state (what the hook reads) tracks the active profile.
    const state = JSON.parse(readFileSync(paths.state, "utf8"));
    assert.equal(state.active, "prod");
    assert.equal(state.mcp_url, "https://api.luminiteapp.com/api/mcp");
    assert.deepEqual(Object.keys(state.profiles).sort(), ["local", "prod"]);

    const { active, profiles } = listProfiles(paths);
    assert.equal(active, "prod");
    assert.equal(profiles.local.mcp_url, "http://localhost:8899/api/mcp");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setProfile patches a profile's URL in place, keeping the existing token", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-set-"));
  try {
    const paths = configPaths(root);
    writeConfig(paths, { name: "local", mcpUrl: "http://localhost/api/mcp", apiUrl: "http://localhost/api", rawToken: "keep-me", tokenId: 2, projectId: 1, projectName: "P" });

    const prof = setProfile(paths, "local", { mcpUrl: "http://host.docker.internal/api/mcp" });
    assert.equal(prof.mcp_url, "http://host.docker.internal/api/mcp");
    assert.equal(prof.raw_token, "keep-me"); // token untouched

    const mcp = JSON.parse(readFileSync(paths.mcpJson, "utf8"));
    const settings = JSON.parse(readFileSync(paths.settingsLocal, "utf8"));
    assert.equal(mcp.mcpServers.luminite.url, "http://host.docker.internal/api/mcp");
    assert.equal(settings.env.LUMINITE_TOKEN, "keep-me");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setProfile refuses a brand-new profile that lacks a token", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-set2-"));
  try {
    const paths = configPaths(root);
    assert.equal(setProfile(paths, "staging", { mcpUrl: "http://x/api/mcp" }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("applyProfile returns null for an unknown profile", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-noprof-"));
  try {
    const paths = configPaths(root);
    writeConfig(paths, { name: "prod", mcpUrl: "https://x/api/mcp", apiUrl: "https://x/api", rawToken: "t", tokenId: 1, projectId: 1 });
    assert.equal(applyProfile(paths, "staging"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy flat state migrates into a 'prod' profile on read", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-migrate-"));
  try {
    const paths = configPaths(root);
    // Simulate a pre-profiles install: flat state + token in settings.local.
    writeConfig(paths, { mcpUrl: "https://old/api/mcp", apiUrl: "https://old/api", rawToken: "old-tok", tokenId: 9, projectId: 4 });
    // Rewrite state to the OLD flat-only shape (drop profiles) to prove migration.
    const flat = { token_id: 9, project_id: 4, api_url: "https://old/api", mcp_url: "https://old/api/mcp" };
    writeFileSync(paths.state, JSON.stringify(flat));

    const { active, profiles } = listProfiles(paths);
    assert.equal(active, "prod");
    assert.equal(profiles.prod.mcp_url, "https://old/api/mcp");
    assert.equal(profiles.prod.raw_token, "old-tok"); // pulled from settings.local
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeConfig writes the Luminite block to project-root CLAUDE.md without gitignoring it", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-claudemd-"));
  try {
    const paths = configPaths(dir);
    writeConfig(paths, {
      mcpUrl: "https://api.luminiteapp.com/api/mcp",
      apiUrl: "https://api.luminiteapp.com",
      rawToken: "tok-xyz",
      tokenId: 7,
      projectId: 3,
    });
    const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    assert.ok(claude.includes("<!-- LUMINITE:START -->"));
    assert.ok(claude.includes("## Luminite project sync"));
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.ok(!gi.includes("CLAUDE.md"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discoverRepos: a git-repo root → ['.']", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-disc-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    assert.deepEqual(discoverRepos(root), ["."]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("discoverRepos: non-git root → its child git repos only", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-disc2-"));
  try {
    mkdirSync(join(root, "api", ".git"), { recursive: true });
    mkdirSync(join(root, "web", ".git"), { recursive: true });
    mkdirSync(join(root, "docs"), { recursive: true }); // no .git → excluded
    assert.deepEqual(discoverRepos(root).sort(), ["api", "web"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeConfig seeds watch_repos and preserves a user correction across re-run + switch", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-wr-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true }); // root is a git repo → seeds ["."]
    const paths = configPaths(root);
    writeConfig(paths, { name: "prod", mcpUrl: "https://x/api/mcp", apiUrl: "https://x/api", rawToken: "t", tokenId: 1, projectId: 1, projectName: "P" });

    let state = JSON.parse(readFileSync(paths.state, "utf8"));
    assert.deepEqual(state.watch_repos, ["."]);

    // User prunes the list by hand.
    state.watch_repos = ["api", "web"];
    writeFileSync(paths.state, JSON.stringify(state));

    // A second connect must NOT clobber the correction.
    writeConfig(paths, { name: "local", mcpUrl: "http://l/api/mcp", apiUrl: "http://l/api", rawToken: "t2", tokenId: 2, projectId: 1, projectName: "P" });
    state = JSON.parse(readFileSync(paths.state, "utf8"));
    assert.deepEqual(state.watch_repos, ["api", "web"]);

    // Switching profiles must preserve it too.
    applyProfile(paths, "prod");
    state = JSON.parse(readFileSync(paths.state, "utf8"));
    assert.deepEqual(state.watch_repos, ["api", "web"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeConfig gitignores the thread cursor file", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-gi-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    const paths = configPaths(root);
    writeConfig(paths, { name: "prod", mcpUrl: "https://x/api/mcp", apiUrl: "https://x/api", rawToken: "t", tokenId: 1, projectId: 1, projectName: "P" });
    assert.match(readFileSync(paths.gitignore, "utf8"), /\.claude\/luminite-thread-cursor\.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeConfig preserves an empty watch_repos (user chose to watch nothing)", () => {
  const root = mkdtempSync(join(tmpdir(), "lc-empty-"));
  try {
    mkdirSync(join(root, ".git"), { recursive: true });
    const paths = configPaths(root);
    writeConfig(paths, { name: "prod", mcpUrl: "https://x/api/mcp", apiUrl: "https://x/api", rawToken: "t", tokenId: 1, projectId: 1, projectName: "P" });

    // User prunes to empty: watch nothing.
    const s0 = JSON.parse(readFileSync(paths.state, "utf8"));
    s0.watch_repos = [];
    writeFileSync(paths.state, JSON.stringify(s0));

    // A re-run must NOT re-seed the empty list back to ["."].
    writeConfig(paths, { name: "prod", mcpUrl: "https://x/api/mcp", apiUrl: "https://x/api", rawToken: "t", tokenId: 1, projectId: 1, projectName: "P" });
    const s1 = JSON.parse(readFileSync(paths.state, "utf8"));
    assert.deepEqual(s1.watch_repos, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeConfig re-run does not duplicate the CLAUDE.md block", () => {
  const dir = mkdtempSync(join(tmpdir(), "lc-claudemd2-"));
  try {
    const paths = configPaths(dir);
    const args = {
      mcpUrl: "https://api.luminiteapp.com/api/mcp",
      apiUrl: "https://api.luminiteapp.com",
      rawToken: "tok",
      tokenId: 1,
      projectId: 1,
    };
    writeConfig(paths, args);
    writeConfig(paths, args);
    const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8");
    assert.equal((claude.match(/LUMINITE:START/g) || []).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
