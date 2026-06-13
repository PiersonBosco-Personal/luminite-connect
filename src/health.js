/** True if the token authenticates against the MCP endpoint. */
export async function checkToken(mcpUrl, token) {
  try {
    const res = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
