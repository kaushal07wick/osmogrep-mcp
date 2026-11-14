// Controlled hosted acceptance fixture; not used by the MCP server.
export function isExpired(expiresAt, now) {
  return now > expiresAt;
}
