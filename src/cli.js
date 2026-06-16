#!/usr/bin/env node
import { readJson, writeConfig } from "./config.js";
import { parseArgs } from "./args.js";
import { configPaths, findProjectRoot } from "./paths.js";
import { checkToken } from "./health.js";
import { connectViaBrowser } from "./connect.js";
import { installHookHelper } from "./hooks.js";
import os from "node:os";

const HELP = `luminite-connect — connect this repo to its Luminite project for Claude Code

Usage:
  npx luminite-connect            Connect (no-op if already connected)
  npx luminite-connect --rotate   Force a fresh token; revokes the old one
  npx luminite-connect --url <u>  Point at a non-default Luminite web app (default https://app.luminiteapp.com)
  npx luminite-connect --help`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const paths = configPaths(findProjectRoot(process.cwd()));

const state = readJson(paths.state, null);
const settings = readJson(paths.settingsLocal, {});
const existingToken = settings?.env?.LUMINITE_TOKEN;
const existingMcpUrl = state?.mcp_url;

// Idempotent: if a token already works and we're not rotating, do nothing.
// The MCP URL comes from the persisted state — the API host is on a different
// subdomain than the web app and is not derivable from args.url.
if (!args.rotate && existingToken && existingMcpUrl && (await checkToken(existingMcpUrl, existingToken))) {
  console.log(`Already connected to ${state?.project_name ?? "Luminite"} ✓  (use --rotate for a fresh token)`);
  process.exit(0);
}

const reason = args.rotate ? "Rotating token…" : existingToken ? "Token invalid — reconnecting…" : "Connecting…";
console.log(reason);

try {
  const result = await connectViaBrowser(args.url, {
    name: `CLI — ${os.hostname()}`,
    revokeTokenId: args.rotate ? state?.token_id : undefined,
  });

  // The CLI bakes in no API host; the connect page must return one. If it
  // doesn't, the web app is out of date — fail loudly instead of writing a
  // broken .mcp.json that would 404 on every MCP call.
  if (!result.mcpUrl) {
    throw new Error("The connect page did not return an MCP URL. Update the Luminite web app, then retry.");
  }

  writeConfig(paths, {
    mcpUrl: result.mcpUrl,
    apiUrl: result.apiUrl,
    rawToken: result.token,
    tokenId: result.tokenId,
    projectId: result.projectId,
  });
  installHookHelper(paths);

  console.log(`\nConnected to ${result.projectName} ✓`);
  console.log("Wrote CLAUDE.md (Luminite sync block), .mcp.json, .claude/settings.local.json, and the SessionStart/Stop hooks.");
  console.log("Open this repo in Claude Code — it will pull project context and sync TODOs automatically.");
} catch (err) {
  console.error(`\nConnection failed: ${err.message}`);
  process.exit(1);
}
