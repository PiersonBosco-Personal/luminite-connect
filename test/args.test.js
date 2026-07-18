import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/args.js";

test("defaults", () => {
  const a = parseArgs([]);
  assert.equal(a.rotate, false);
  assert.equal(a.help, false);
  assert.equal(a.url, "https://app.luminiteapp.com");
});

test("flags", () => {
  const a = parseArgs(["--rotate", "--url", "http://localhost:8000"]);
  assert.equal(a.rotate, true);
  assert.equal(a.url, "http://localhost:8000");
});

test("help", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("no positional → connect command", () => {
  assert.equal(parseArgs([]).command, "connect");
  assert.equal(parseArgs(["--url", "http://x"]).command, "connect");
});

test("bare profile name is sugar for `use <name>`", () => {
  const a = parseArgs(["local"]);
  assert.equal(a.command, "use");
  assert.equal(a.name, "local");
});

test("explicit use <name>", () => {
  const a = parseArgs(["use", "prod"]);
  assert.equal(a.command, "use");
  assert.equal(a.name, "prod");
});

test("list command", () => {
  assert.equal(parseArgs(["list"]).command, "list");
});

test("--as names the profile for a connect", () => {
  const a = parseArgs(["--url", "http://localhost:5173", "--as", "local"]);
  assert.equal(a.command, "connect");
  assert.equal(a.as, "local");
  assert.equal(a.url, "http://localhost:5173");
});

test("--mcp-url overrides the saved MCP URL (Docker host case)", () => {
  const a = parseArgs(["--url", "http://localhost:5173", "--as", "local", "--mcp-url", "http://host.docker.internal/api/mcp"]);
  assert.equal(a.mcpUrl, "http://host.docker.internal/api/mcp");
  assert.equal(a.command, "connect");
});
