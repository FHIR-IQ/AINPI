/**
 * https://ainpi.dev/api/mcp: the public MCP server. Tools and limits live in
 * src/lib/mcp-server.ts. Keys and OAuth access tokens are optional here; the
 * sign-in-required twin is /api/account/mcp.
 *
 * Connect (Claude Code):
 *   claude mcp add --transport http ainpi https://ainpi.dev/api/mcp
 */
import type { NextRequest } from 'next/server';
import { buildMcpHandler, guarded } from '@/lib/mcp-server';

const handler = buildMcpHandler('/api') as unknown as (r: NextRequest) => Promise<Response>;

export async function GET(req: NextRequest) {
  return guarded(req, handler);
}
export async function POST(req: NextRequest) {
  return guarded(req, handler);
}
export async function DELETE(req: NextRequest) {
  return guarded(req, handler);
}
