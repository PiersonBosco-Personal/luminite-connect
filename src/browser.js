import { spawn } from "node:child_process";

export function openBrowser(url) {
  const win32 = process.platform === "win32";
  const cmd =
    process.platform === "darwin" ? "open" :
    win32 ? "cmd" :
    "xdg-open";

  // On Windows, cmd.exe treats `&` (common in our query string) as a command
  // separator, which truncates the URL and drops the `state` param — causing a
  // "State mismatch" on the callback. Wrap the URL in double quotes so `&` is
  // literal, and use windowsVerbatimArguments so Node passes the quotes through
  // untouched. The empty quoted title ("") keeps `start` from treating the URL
  // as the window title.
  const args = win32 ? ["/c", "start", '""', `"${url}"`] : [url];
  const opts = { stdio: "ignore", detached: true };
  if (win32) opts.windowsVerbatimArguments = true;

  try {
    spawn(cmd, args, opts).unref();
  } catch {
    /* fall through — the URL is also printed for manual open */
  }
}
