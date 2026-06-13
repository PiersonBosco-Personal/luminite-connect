import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { openBrowser } from "./browser.js";

/**
 * Run the browser authorize flow. Opens <appUrl>/cli/connect with a loopback
 * callback, waits for the redirect, and resolves the minted token details.
 * The connect page also returns the API/MCP URLs (the API lives on a different
 * host than the web app), so the CLI learns them from the server rather than
 * deriving them from appUrl.
 * @returns {Promise<{token:string, tokenId:number, projectId:number, projectName:string, mcpUrl:string, apiUrl:string}>}
 */
export function connectViaBrowser(appUrl, { name, revokeTokenId } = {}) {
  return new Promise((resolve, reject) => {
    const state = randomBytes(16).toString("hex");

    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400).end("State mismatch. Close this tab and re-run luminite-connect.");
        return;
      }
      const token = url.searchParams.get("token");
      if (!token) {
        res.writeHead(400).end("No token returned.");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        "<h2>Connected ✓</h2><p>You can close this tab and return to your terminal.</p>",
      );
      server.close();
      resolve({
        token,
        tokenId: Number(url.searchParams.get("token_id")),
        projectId: Number(url.searchParams.get("project_id")),
        projectName: url.searchParams.get("project_name") || "",
        mcpUrl: url.searchParams.get("mcp_url") || "",
        apiUrl: url.searchParams.get("api_url") || "",
      });
    });

    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const callback = `http://127.0.0.1:${port}/callback`;
      const connectUrl = new URL(`${appUrl}/cli/connect`);
      connectUrl.searchParams.set("callback", callback);
      connectUrl.searchParams.set("state", state);
      connectUrl.searchParams.set("name", name || "CLI");
      if (revokeTokenId) connectUrl.searchParams.set("revoke", String(revokeTokenId));

      console.log("\nOpening your browser to authorize…");
      console.log("If it doesn't open, paste this URL:\n  " + connectUrl.toString() + "\n");
      openBrowser(connectUrl.toString());
    });

    setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for browser authorization (5 min)."));
    }, 5 * 60 * 1000).unref();
  });
}
