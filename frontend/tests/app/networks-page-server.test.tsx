import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

const load = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock('@/lib/load-api-v1', async (orig) => {
  const real = await orig<typeof import('@/lib/load-api-v1')>();
  return { ...real, loadNetworks: () => (load.value === undefined ? real.loadNetworks() : load.value) };
});
vi.mock('@/components/Navbar', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/networks',
}));

import NetworksPage, { metadata } from '@/app/networks/page';

/** Count elements in a server-rendered tree that receive the payload prop. */
function countPayloadProps(node: ReactNode): number {
  if (Array.isArray(node)) return node.reduce((n: number, c) => n + countPayloadProps(c), 0);
  if (!node || typeof node !== 'object' || !('props' in node)) return 0;
  const el = node as ReactElement<Record<string, unknown>>;
  let n = el.props && 'payload' in el.props ? 1 : 0;
  for (const v of Object.values(el.props ?? {})) if (v && typeof v === 'object') n += countPayloadProps(v as ReactNode);
  return n;
}

beforeEach(() => {
  load.value = undefined;
});

describe('/networks page (server)', () => {
  it('fails the build when networks.json cannot be read', () => {
    load.value = null;
    expect(() => NetworksPage()).toThrow(/networks\.json/);
  });

  it('passes the payload to the client exactly once', () => {
    expect(countPayloadProps(NetworksPage())).toBe(1);
  });

  it('declares an Open Graph type of website', () => {
    expect((metadata.openGraph as { type?: string }).type).toBe('website');
  });
});
