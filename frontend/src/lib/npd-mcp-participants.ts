/**
 * Public read of the NPD MCP working group list: organization name and type
 * of rows whose submitter ticked "List our organization's name and type on
 * this page" and that an admin has approved (approved = true, set by hand
 * after a check). Nothing else is ever selected, so contact details cannot
 * reach the page.
 *
 * Returns [] on any database error (for example before the table exists in
 * production), so the page renders its empty state instead of failing.
 */
import { prisma } from '@/lib/prisma';

export interface PublicParticipant {
  organization: string;
  orgType: string;
}

export async function listPublicParticipants(): Promise<PublicParticipant[]> {
  try {
    const rows = await prisma.npdMcpParticipant.findMany({
      where: { listPublicly: true, approved: true },
      select: { organization: true, orgType: true },
      orderBy: { createdAt: 'asc' },
    });
    // One organization may sign up more than once; list it once.
    const seen = new Set<string>();
    const out: PublicParticipant[] = [];
    for (const r of rows) {
      const key = `${r.organization.trim().toLowerCase()}|${r.orgType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ organization: r.organization, orgType: r.orgType });
    }
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[npd-mcp] public participant list unavailable:', msg);
    return [];
  }
}
