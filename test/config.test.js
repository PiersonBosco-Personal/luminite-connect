import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMcpJson, mergeSettingsLocal, ensureGitignored } from "../src/config.js";

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
  const cmds = next.hooks.Stop[0].hooks[0].command;
  assert.match(cmds, /luminite-hook\.mjs stop/);
  assert.match(next.hooks.SessionStart[0].hooks[0].command, /session-start/);
});

test("ensureGitignored appends only missing entries", () => {
  const out = ensureGitignored("node_modules\n.claude/settings.local.json\n", [
    ".claude/settings.local.json",
    ".claude/luminite-connect.json",
  ]);
  assert.equal((out.match(/luminite-connect\.json/g) || []).length, 1);
  assert.match(out, /node_modules/);
});
