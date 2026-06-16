import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

/** Walk up from cwd to the first dir containing .git; fall back to cwd. */
export function findProjectRoot(cwd) {
  let dir = cwd;
  const { root } = parse(cwd);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dir === root) return cwd;
    dir = dirname(dir);
  }
}

export function configPaths(root) {
  return {
    root,
    mcpJson: join(root, ".mcp.json"),
    claudeDir: join(root, ".claude"),
    settingsLocal: join(root, ".claude", "settings.local.json"),
    state: join(root, ".claude", "luminite-connect.json"),
    hooksDir: join(root, ".claude", "hooks"),
    hookHelper: join(root, ".claude", "hooks", "luminite-hook.mjs"),
    gitignore: join(root, ".gitignore"),
    claudeMd: join(root, "CLAUDE.md"),
  };
}
