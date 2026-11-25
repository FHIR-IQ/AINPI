/**
 * https://ainpi.dev/api/account/mcp: the same MCP tools as /api/mcp, with
 * sign-in required. A request without a bearer token, or with one that is
 * unknown, revoked or expired, gets 401 and an RFC 9728 WWW-Authenticate
 * header pointing at the protected-resource metadata, which is how a client
 * such as a claude.ai custom connector knows to start OAuth. Sign-in is with
 * an AINPI API key (src/app/oauth/authorize). A raw API key also works here.
 */
import type { NextRequest } from 'next/server';
import { buildMcpHandler, guarded } from '@/lib/mcp-server';

const handler = buildMcpHandler('/api/account') as unknown as (r: NextRequest) => Promise<Response>;

export async function GET(req: NextRequest) {
  return guarded(req, handler, { requireAuth: true });
}
export async function POST(req: NextRequest) {
  return guarded(req, handler, { requireAuth: true });
}
export async function DELETE(req: NextRequest) {
  return guarded(req, handler, { requireAuth: true });
}
