import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  SystemReachCell,
  SystemsCorrections,
  countsDistinct,
  reachParts,
} from '@/components/connectivity/SystemReach';
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
});
