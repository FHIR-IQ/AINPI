/**
 * The one module-scope copy of the organization endpoint index (H50
 * crosswalk + H51 vendor file, ~33 MB parsed) shared by every caller in a
 * lambda: the lookup_organization MCP tool and roster verification.
 */
import { createOrgIndexLoader } from '@/lib/org-lookup';

export const loadOrgIndex = createOrgIndexLoader({
  base: 'https://ainpi.dev',
  ttlMs: 6 * 60 * 60 * 1000,
  fetchText: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.text();
  },
});
