#!/usr/bin/env node
import { writeConfig, applyProfile, listProfiles } from "./config.js";
import { parseArgs } from "./args.js";
import { configPaths, findProjectRoot } from "./paths.js";
import { checkToken } from "./health.js";
import { connectViaBrowser } from "./connect.js";
import { installHookHelper } from "./hooks.js";
import os from "node:os";

const HELP = `luminite-connect — connect this repo to its Luminite project for Claude Code

Usage:
  npx luminite-connect                  Connect (no-op if already connected) — saves the "prod" profile
  npx luminite-connect --url <u> --as <name>
                                        Connect against another Luminite (e.g. local) and save it as <name>
  npx luminite-connect <name>           Switch: point Claude Code at the saved <name> profile
  npx luminite-connect use <name>       Same as above (explicit form)
  npx luminite-connect list             List saved profiles (* = active)
  npx luminite-connect --rotate         Force a fresh token; revokes the old one
  npx luminite-connect --help

After switching, restart Claude Code (or reload the window) so it re-reads the token and MCP URL.
Note: each environment needs its OWN token — a prod token is not in the local database and vice versa.
The profile remembers the right token for you, so switching never means re-pasting one.`;

const LOCAL_HOST = /(localhost|127\.0\.0\.1|0\.0\.0\.0)/;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const paths = configPaths(findProjectRoot(process.cwd()));

if (args.command === "list") {
  const { active, profiles } = listProfiles(paths);
  const names = Object.keys(profiles);
  if (!names.length) {
    console.log("No profiles yet. Run `npx luminite-connect` to create one.");
    process.exit(0);
  }
  for (const n of names) {
    const p = profiles[n];
    const mark = n === active ? "*" : " ";
    console.log(`${mark} ${n.padEnd(10)} ${p.mcp_url}${p.project_name ? `   (${p.project_name})` : ""}`);
  }
  process.exit(0);
}

if (args.command === "use") {
  if (!args.name) {
    console.error("Usage: npx luminite-connect use <name>");
    process.exit(1);
  }
  const prof = applyProfile(paths, args.name);
  if (!prof) {
    const { profiles } = listProfiles(paths);
    const known = Object.keys(profiles).join(", ") || "(none — run `npx luminite-connect` first)";
    console.error(`No profile "${args.name}". Known: ${known}`);
    process.exit(1);
  }
  console.log(`Switched to "${args.name}" → ${prof.mcp_url}`);
  const ok = await checkToken(prof.mcp_url, prof.raw_token);
  console.log(
    ok
      ? "Token authenticates ✓"
      : "⚠ Token did NOT authenticate — that environment may be down or the token was revoked. Reconnect it with `npx luminite-connect --url <app> --as " + args.name + "`.",
  );
  console.log("Restart Claude Code (or reload the window) to pick up the new token/URL.");
  process.exit(0);
}

// ── connect ──────────────────────────────────────────────────────────────────
const name = args.as ?? (LOCAL_HOST.test(args.url) ? "local" : "prod");
const { profiles } = listProfiles(paths);
const existing = profiles[name];

// Idempotent: if this profile's token still works and we're not rotating, just
// make sure the live files point at it and finish.
if (!args.rotate && existing?.raw_token && existing?.mcp_url && (await checkToken(existing.mcp_url, existing.raw_token))) {
  applyProfile(paths, name);
  console.log(`Already connected as "${name}" → ${existing.project_name ?? "Luminite"} ✓  (use --rotate for a fresh token)`);
  process.exit(0);
}

const reason = args.rotate ? "Rotating token…" : existing ? "Token invalid — reconnecting…" : "Connecting…";
console.log(reason);

try {
  const result = await connectViaBrowser(args.url, {
    name: `CLI — ${os.hostname()}`,
    revokeTokenId: args.rotate ? existing?.token_id : undefined,
  });

  // The CLI bakes in no API host; the connect page must return one. If it
  // doesn't, the web app is out of date — fail loudly instead of writing a
  // broken .mcp.json that would 404 on every MCP call.
  if (!result.mcpUrl) {
    throw new Error("The connect page did not return an MCP URL. Update the Luminite web app, then retry.");
  }

  writeConfig(paths, {
    name,
    mcpUrl: result.mcpUrl,
    apiUrl: result.apiUrl,
    rawToken: result.token,
    tokenId: result.tokenId,
    projectId: result.projectId,
    projectName: result.projectName,
  });
  installHookHelper(paths);

  console.log(`\nConnected to ${result.projectName} ✓  (saved as "${name}")`);
  console.log("Wrote CLAUDE.md (Luminite sync block), .mcp.json, .claude/settings.local.json, and the SessionStart/Stop hooks.");
  if (name !== "prod") {
    console.log(`Switch anytime:  npx luminite-connect ${name}   |   npx luminite-connect prod`);
  }
  console.log("Open this repo in Claude Code — it will pull project context and sync TODOs automatically.");
} catch (err) {
  console.error(`\nConnection failed: ${err.message}`);
  process.exit(1);
}
