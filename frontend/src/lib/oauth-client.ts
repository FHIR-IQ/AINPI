import { prisma } from '@/lib/prisma';

/** A registered OAuth client, or null when unknown or the lookup fails. */
export async function loadClient(clientId: string | undefined): Promise<{ id: string; clientName: string | null; redirectUris: string[] } | null> {
  if (!clientId || !/^[0-9a-f-]{36}$/i.test(clientId)) return null;
  try {
    const row = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
    if (!row) return null;
    const uris = Array.isArray(row.redirectUris) ? row.redirectUris.filter((u): u is string => typeof u === 'string') : [];
    return { id: row.id, clientName: row.clientName, redirectUris: uris };
  } catch {
    return null;
  }
}
