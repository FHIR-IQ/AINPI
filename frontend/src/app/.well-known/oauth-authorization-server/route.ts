/** RFC 8414 authorization server metadata for the AINPI MCP sign-in. */
import { authorizationServerMetadata } from '@/lib/oauth';
import { json, preflight } from '@/lib/oauth-http';

export const dynamic = 'force-static';

export function GET() {
  return json(authorizationServerMetadata(), 200, { 'cache-control': 'public, max-age=3600' });
}
export function OPTIONS() {
  return preflight();
}
