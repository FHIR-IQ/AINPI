/**
 * RFC 9728 protected-resource metadata. Served at the bare path and at the
 * path-suffixed form for each MCP endpoint, e.g.
 * /.well-known/oauth-protected-resource/api/account/mcp.
 */
import { ISSUER, RESOURCES, protectedResourceMetadata } from '@/lib/oauth';
import { json, preflight } from '@/lib/oauth-http';

export function GET(_req: Request, { params }: { params: { path?: string[] } }) {
  const suffix = (params.path ?? []).join('/');
  const resource = suffix ? `${ISSUER}/${suffix}` : RESOURCES[0];
  if (!(RESOURCES as readonly string[]).includes(resource)) return json({ error: 'not_found' }, 404);
  return json(protectedResourceMetadata(resource), 200, { 'cache-control': 'public, max-age=3600' });
}
export function OPTIONS() {
  return preflight();
}
