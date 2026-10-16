import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  EndpointCountCell,
  KnownSystemsUnreached,
  SystemReachCell,
  SystemsCorrections,
  TIER_LABELS,
  basisLabel,
  countsDistinct,
  endpointSplit,
  isInferredTier,
  reachParts,
} from '@/components/connectivity/SystemReach';
import { POINT_BLUE, POINT_SIGNAL, pointStyle } from '@/components/charts/state-geo-style';
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

describe('FHI-73 QA: tier order, basis labels, map points, unreached systems', () => {
  it('ranks a curated alias above a vendor NPI list', () => {
    const order = Object.keys(TIER_LABELS);
    expect(order.indexOf('alias')).toBeLessThan(order.indexOf('vendor-npi-list'));
    expect(order.indexOf('vendor-npi-list')).toBeLessThan(order.indexOf('name-state'));
  });

  it('marks every tier but NDH and vendor NPI as inferred', () => {
    expect(isInferredTier('ndh')).toBe(false);
    expect(isInferredTier('vendor-npi')).toBe(false);
    for (const t of ['alias', 'vendor-npi-list', 'name-state', 'brand-state']) {
      expect(isInferredTier(t)).toBe(true);
    }
    expect(isInferredTier(null)).toBe(false);
    expect(isInferredTier('name-candidate')).toBe(false);
  });

  it('labels the basis in words, with the list size', () => {
    expect(basisLabel('vendor-npi-list', 42)).toBe('vendor list (42 NPIs)');
    expect(basisLabel('vendor-npi', 3)).toBe('vendor NPI (3 NPIs on URL)');
    expect(basisLabel('vendor-npi', 1)).toBe('vendor NPI');
    expect(basisLabel('alias')).toBe('curated alias');
    expect(basisLabel(null)).toBeNull();
  });

  it('draws inferred points as a dashed hollow ring, deterministic filled', () => {
    expect(pointStyle('ndh')).toEqual({ fill: POINT_BLUE, stroke: POINT_BLUE, dashed: false });
    expect(pointStyle('vendor-npi-list')).toEqual({ fill: 'none', stroke: POINT_BLUE, dashed: true });
    expect(pointStyle('alias').dashed).toBe(true);
    expect(pointStyle(null)).toEqual({ fill: 'none', stroke: POINT_SIGNAL, dashed: false });
  });

  it('renders the known-systems-unreached row with its enrollment reach', () => {
    render(
      <KnownSystemsUnreached
        block={{
          note: 'note',
          rows: [
            {
              system: 'Jefferson',
              domains: ['jefferson.edu'],
              reason: 'r',
              reached_through_member_tiers: 0,
              reached_through_enrollment_only: 1378,
              listed_reason: 'measured',
              via: ['CMS-enrolled group: Jefferson University Physicians'],
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('known-systems-unreached')).toBeTruthy();
    expect(screen.getByText('Jefferson')).toBeTruthy();
    expect(screen.getByText('1,378*')).toBeTruthy();
    expect(screen.getByText(/Jefferson University Physicians/)).toBeTruthy();
  });

  it('renders the funnel correction under its own title and test id', () => {
    render(
      <SystemsCorrections
        corrections={[{ date: 'd', issue: 'FHI-73', what: 'The headline moved.', since: 's' }]}
        title="Correction to the headline figures"
        testId="funnel-corrections"
      />,
    );
    expect(screen.getByTestId('funnel-corrections').textContent).toMatch(/headline moved/);
  });
});
