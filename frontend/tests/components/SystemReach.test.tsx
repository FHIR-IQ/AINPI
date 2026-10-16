import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  EndpointCountCell,
  SystemReachCell,
  SystemsCorrections,
  countsDistinct,
  endpointSplit,
  reachParts,
} from '@/components/connectivity/SystemReach';
import {
  linkDash,
  linkInferred,
  systemFilled,
  systemInferredOnly,
} from '@/components/charts/connectivity-graph-style';
import type { ConnectivitySystem } from '@/lib/connectivity-types';

const base: ConnectivitySystem = {
  system_key: 'brand:GEISINGER',
  label: 'GEISINGER',
  basis: 'brand-name',
  organizations: 120,
  practitioners: 5199,
  member_org_ids: [],
  endpoint_count: 1,
  endpoints: [],
  vendors: [],
};

const tiered: ConnectivitySystem = {
  ...base,
  practitioner_org_links: 16799,
  reaches_endpoint: 5200,
  reaches_endpoint_deterministic: 1,
  reach_by_tier: {
    ndh: 1,
    'vendor-npi': 0,
    'vendor-npi-list': 0,
    alias: 0,
    'name-state': 0,
    'brand-state': 5198,
    'cms-enrollment-own-endpoint': 1,
  },
};

describe('SystemReach', () => {
  it('tells distinct counts from the pre-FHI-73 link sum', () => {
    expect(countsDistinct(base)).toBe(false);
    expect(countsDistinct(tiered)).toBe(true);
  });

  it('lists non-zero tiers strongest first and marks inference', () => {
    const parts = reachParts(tiered);
    expect(parts.map((p) => p.tier)).toEqual([
      'ndh',
      'brand-state',
      'cms-enrollment-own-endpoint',
    ]);
    expect(parts.map((p) => p.inferred)).toEqual([false, true, true]);
  });

  it('renders every tier rather than one number', () => {
    render(<SystemReachCell row={tiered} />);
    expect(screen.getByText('5,200')).toBeTruthy();
    expect(screen.getByText(/brand match 5,198\*/)).toBeTruthy();
    expect(screen.getByText(/NDH 1/)).toBeTruthy();
  });

  it('renders a dash for payloads without per-tier reach', () => {
    const { container } = render(<SystemReachCell row={base} />);
    expect(container.textContent).toBe('—');
  });

  it('shows the correction with its date range, and nothing without one', () => {
    const { container, rerender } = render(<SystemsCorrections />);
    expect(container.textContent).toBe('');
    rerender(
      <SystemsCorrections
        corrections={[
          {
            date: '2026-10-16',
            issue: 'FHI-73',
            what: 'The table counted only two tiers.',
            since: '2026-10-13',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('systems-corrections').textContent).toContain(
      'Affected since 2026-10-13.',
    );
  });

  it('shows the deterministic subtotal next to the all-tier reach', () => {
    render(<SystemReachCell row={tiered} />);
    expect(screen.getByText('(1 NDH or vendor NPI)')).toBeTruthy();
  });
});

describe('EndpointCountCell', () => {
  it('splits deterministic and inferred endpoints with a star', () => {
    const row = { ...tiered, endpoint_count: 3, endpoint_count_deterministic: 1 };
    expect(endpointSplit(row)).toEqual({ deterministic: 1, inferred: 2 });
    const { container } = render(<EndpointCountCell row={row} />);
    expect(container.textContent).toBe('1 + 2*');
  });

  it('shows a zero deterministic count in signal when only inference reaches', () => {
    const row = { ...tiered, endpoint_count: 1, endpoint_count_deterministic: 0 };
    const { container } = render(<EndpointCountCell row={row} />);
    expect(container.textContent).toBe('0 + 1*');
    expect(container.querySelector('.text-signal')?.textContent).toBe('0');
  });

  it('renders the bare count for payloads without the split', () => {
    expect(endpointSplit(base)).toBeNull();
    const { container } = render(<EndpointCountCell row={base} />);
    expect(container.textContent).toBe('1');
  });
});

describe('connectivity graph style', () => {
  it('fills a system only when a deterministic tier reaches it', () => {
    const inferred = { id: 's', label: 'S', type: 'system' as const,
      connected: true, connected_deterministic: false };
    expect(systemFilled(inferred)).toBe(false);
    expect(systemInferredOnly(inferred)).toBe(true);
    expect(systemFilled({ ...inferred, connected_deterministic: true })).toBe(true);
    // Older payloads: fall back to `connected`.
    expect(systemFilled({ id: 's', label: 'S', type: 'system', connected: true })).toBe(true);
    expect(systemInferredOnly({ id: 's', label: 'S', type: 'system', connected: false })).toBe(false);
  });

  it('dashes inferred reaches links and keeps vendor links dotted', () => {
    expect(linkInferred({ kind: 'reaches', tier: 'brand-state' })).toBe(true);
    expect(linkDash({ kind: 'reaches', tier: 'brand-state' })).toBe('6 3');
    expect(linkDash({ kind: 'reaches', tier: 'ndh' })).toBeNull();
    expect(linkDash({ kind: 'reaches' })).toBeNull();
    expect(linkDash({ kind: 'served-by' })).toBe('3 3');
  });
});
