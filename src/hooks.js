import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Copy the hook helper into the target repo's .claude/hooks/. */
export function installHookHelper(paths) {
  if (!existsSync(paths.hooksDir)) mkdirSync(paths.hooksDir, { recursive: true });
  copyFileSync(join(here, "templates", "luminite-hook.mjs"), paths.hookHelper);
}
