// @vitest-environment node
/**
 * Every MCP tool carries annotations, through the real /api/mcp route.
 *
 * Connector directories (Claude's included) require each tool to declare
 * whether it only reads. Clients use readOnlyHint to decide whether to ask the
 * user before a call. Only report_interaction writes (one sandbox row, keyed
 * on reportId, so a repeat is idempotent); every other tool reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ queryRaw: vi.fn(), findUnique: vi.fn() }));

vi.mock('@/lib/prisma', () => {
  const client = {
    apiKey: { findUnique: m.findUnique, update: vi.fn() },
    usageLedger: { update: vi.fn() },
    $queryRaw: m.queryRaw,
  };
  return { default: client, prisma: client };
});

import { POST } from '@/app/api/mcp/route';
import { TOOL_ANNOTATIONS } from '@/lib/mcp-server';

interface ListedTool {
  name: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

async function listTools(): Promise<ListedTool[]> {
  m.queryRaw.mockRejectedValue(new Error('no database in unit tests'));
  const res = await POST(
    new NextRequest('https://ainpi.dev/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-forwarded-for': '203.0.113.11',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }),
    }),
  );
  const body = await res.text();
  const line = body.split('\n').find((l) => l.startsWith('data: '));
  const msg = JSON.parse(line ? line.slice(6) : body);
  return msg.result.tools as ListedTool[];
}

describe('MCP tool annotations', () => {
  it('annotates every listed tool with a title and readOnlyHint', async () => {
    const tools = await listTools();
    expect(tools.length).toBeGreaterThanOrEqual(10);
    for (const t of tools) {
      expect(t.annotations, t.name).toBeDefined();
      expect(typeof t.annotations?.title, t.name).toBe('string');
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe('boolean');
    }
    expect(Object.keys(TOOL_ANNOTATIONS).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it('marks only report_interaction as a write, and it is not destructive', async () => {
    const tools = await listTools();
    const writes = tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name);
    expect(writes).toEqual(['report_interaction']);
    const report = tools.find((t) => t.name === 'report_interaction')!;
    expect(report.annotations?.destructiveHint).toBe(false);
    expect(report.annotations?.idempotentHint).toBe(true);
  });

  it('marks verify_roster as reaching outside AINPI (live NPPES)', async () => {
    const tools = await listTools();
    expect(tools.find((t) => t.name === 'verify_roster')?.annotations?.openWorldHint).toBe(true);
  });
});
