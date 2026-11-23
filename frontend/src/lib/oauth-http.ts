/** CORS and JSON helpers for the OAuth endpoints, which browser-based MCP clients call cross-origin. */
export const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-protocol-version',
  'access-control-max-age': '86400',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...extra },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
