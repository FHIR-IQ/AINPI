import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { NetworksPayload } from '@/lib/api-v1-types';

// Search params and router are mocked; the map is replaced by a stub that
// exposes the cells it was given, so shading is asserted without D3 or a fetch.
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  usePathname: () => '/networks',
}));
vi.mock('next/dynamic', () => ({
  default: () =>
    function StubMap(props: {
      cells: Record<string, { category: string; verified: boolean }>;
      onStateClick: (c: string) => void;
    }) {
      return (
        <div data-testid="map">
          {Object.entries(props.cells).map(([code, c]) => (
            <button
              key={code}
              type="button"
              data-testid={`cell-${code}`}
              data-category={c.category}
              onClick={() => props.onStateClick(code)}
            >
              {`map-${code}`}
            </button>
          ))}
        </div>
      );
    },
}));

import { cellStyle } from '@/components/charts/network-map-style';
import NetworksClient from '@/app/networks/networks-client';

const src = (url: string, accessed = '2026-11-01') => ({ url, title: `Source ${url}`, accessed, primary: true });

const fixture: NetworksPayload = {
  schema_version: 1,
  generated_at: '2026-11-06',
  use_cases: [
    { slug: 'treatment-records', label: 'Get a patient\'s records for treatment', summary: 'Treatment summary.', ainpi_links: [] },
    { slug: 'individual-access', label: 'Get my own records (as a patient)', summary: 'Access summary.', ainpi_links: [] },
    {
      slug: 'find-endpoint',
      label: 'Find a provider\'s endpoint',
      summary: 'Endpoint summary.',
      ainpi_links: [
        { label: 'Published finding link', finding_slug: 'endpoint-url-validity' },
        { label: 'Unpublished finding link', finding_slug: 'not-a-real-finding-slug' },
      ],
    },
    { slug: 'payer-exchange', label: 'Exchange data with a health plan', summary: 'Payer summary.', ainpi_links: [] },
    { slug: 'encounter-alerts', label: 'Get admit and discharge alerts', summary: 'Alerts summary.', ainpi_links: [] },
    { slug: 'public-health', label: 'Report to public health', summary: 'Public health summary.', ainpi_links: [] },
    { slug: 'community-referral', label: 'Refer someone to a community organization', summary: 'Referral summary.', ainpi_links: [] },
  ],
  routes: [
    {
      id: 'tr-hie',
      use_case: 'treatment-records',
      title: 'Query a state exchange',
      summary: 'A clinician queries the state exchange for records.',
      who_can_use: 'Participating providers.',
      rule: 'HIPAA treatment.',
      standard: 'IHE document query.',
      how_to_join: 'Sign the participation agreement.',
      network_types: ['state_hie', 'multi_state', 'qhin'],
      sources: [src('https://example.org/tr-hie')],
      ainpi_links: [],
    },
    {
      id: 'ph-ecr',
      use_case: 'public-health',
      title: 'Electronic case reporting',
      summary: 'A provider sends reportable conditions.',
      who_can_use: 'Providers with a certified EHR.',
      rule: 'State reporting law.',
      standard: 'HL7 eCR.',
      how_to_join: 'Onboard with the reporting hub.',
      network_types: ['state_hie'],
      sources: [src('https://example.org/ph-ecr'), { url: 'javascript:alert(1)', title: 'Hostile source', accessed: '2026-11-01', primary: false }],
      ainpi_links: [],
    },
  ],
  networks: [
    {
      id: 'pa-hie',
      name: 'Example PA Exchange',
      type: 'state_hie',
      national: false,
      states: ['PA'],
      detail_level: 'full',
      routes: ['tr-hie'],
      website: 'https://example.org/pa',
      how_to_join: 'Contact the exchange.',
      sources: [src('https://example.org/pa')],
      last_checked: '2026-10-01',
    },
    {
      id: 'old-qhin',
      name: 'Example National QHIN',
      type: 'qhin',
      national: true,
      states: [],
      detail_level: 'full',
      routes: ['tr-hie'],
      website: 'https://example.org/qhin',
      how_to_join: 'Join through a participant.',
      sources: [src('https://example.org/qhin', '2026-01-01')],
      last_checked: '2026-01-01',
    },
  ],
  glossary: [{ term: 'HIE', definition: 'Health information exchange.' }],
};

function renderClient(query = '', payload: NetworksPayload = fixture) {
  nav.params = new URLSearchParams(query);
  return render(<NetworksClient payload={payload} buildDate="2026-11-06" publishedSlugs={['endpoint-url-validity']} />);
}

beforeEach(() => nav.replace.mockClear());
afterEach(cleanup);

function chip(name: string) {
  return screen.getByRole('button', { name });
}

describe('/networks client', () => {
  it('selects treatment-records by default', () => {
    renderClient();
    expect(chip("Get a patient's records for treatment").getAttribute('aria-pressed')).toBe('true');
  });

  it('falls back to treatment-records for an unknown use', () => {
    renderClient('use=bogus');
    expect(chip("Get a patient's records for treatment").getAttribute('aria-pressed')).toBe('true');
  });

  it('switches use case, updates the URL and lists only that use case\'s routes', () => {
    renderClient();
    fireEvent.click(chip('Report to public health'));
    expect(nav.replace).toHaveBeenCalledWith('/networks?use=public-health', { scroll: false });
    expect(chip('Report to public health').getAttribute('aria-pressed')).toBe('true');
    const panel = screen.getByTestId('routes-panel');
    expect(within(panel).getByText('Electronic case reporting')).toBeTruthy();
    expect(within(panel).queryByText('Query a state exchange')).toBeNull();
  });

  it('says route detail is being researched when a use case has no routes', () => {
    renderClient('use=individual-access');
    expect(screen.getByText('Route detail for this use case is being researched.')).toBeTruthy();
  });

  it('shows route card headings in order, then sources with accessed date', () => {
    renderClient();
    const card = screen.getByTestId('route-tr-hie');
    const headings = within(card)
      .getAllByRole('heading', { level: 4 })
      .map((h) => h.textContent);
    expect(headings.slice(0, 4)).toEqual(['Who can use it', 'Rule', 'Standard', 'How to join']);
    expect(headings.indexOf('Sources')).toBeGreaterThan(3);
    const srcLink = within(card).getByRole('link', { name: 'Source https://example.org/tr-hie' });
    expect(srcLink.getAttribute('href')).toBe('https://example.org/tr-hie');
    expect(within(card).getByText(/accessed 2026-11-01/)).toBeTruthy();
  });

  it('has two overlay toggles on by default that re-shade the map', () => {
    renderClient();
    const hie = screen.getByLabelText('State HIE') as HTMLInputElement;
    const multi = screen.getByLabelText('Multi-state network') as HTMLInputElement;
    expect(hie.checked).toBe(true);
    expect(multi.checked).toBe(true);
    expect(screen.getByTestId('cell-PA').getAttribute('data-category')).toBe('state_hie');
    fireEvent.click(hie);
    expect(screen.getByTestId('cell-PA').getAttribute('data-category')).toBe('none');
  });

  it('opens a state panel with the empty message and the national list for WY', () => {
    renderClient();
    fireEvent.click(screen.getByTestId('cell-WY'));
    const panel = screen.getByTestId('state-panel');
    expect(within(panel).getByRole('heading', { name: 'Wyoming' })).toBeTruthy();
    expect(within(panel).getByText('No state or multi-state network found in our sources for this state.')).toBeTruthy();
    expect(within(panel).getByText('National networks and programs')).toBeTruthy();
    expect(within(panel).getByText('Example National QHIN')).toBeTruthy();
  });

  it('labels a state with listed networks but none for the selected use case without claiming nothing is listed', () => {
    renderClient('use=public-health');
    const cell = screen.getByTestId('cell-PA');
    expect(cell.getAttribute('data-category')).toBe('none');
    const label = cellStyle('PA', { category: 'none', verified: true }).label;
    expect(label).toBe('No state or multi-state network for this use case in our sources');
    expect(label).not.toMatch(/none listed|nothing/i);
    fireEvent.click(cell);
    expect(within(screen.getByTestId('state-panel')).getByText('Example PA Exchange')).toBeTruthy();
  });

  it('marks a network checked more than 180 days before the build date as needing re-check', () => {
    renderClient();
    const card = screen.getByTestId('route-tr-hie');
    const qhin = within(card).getByTestId('network-old-qhin');
    expect(within(qhin).getByText('Needs re-check')).toBeTruthy();
    fireEvent.click(screen.getByTestId('cell-PA'));
    const panel = screen.getByTestId('state-panel');
    expect(within(within(panel).getByTestId('network-pa-hie')).queryByText('Needs re-check')).toBeNull();
    expect(within(within(panel).getByTestId('network-old-qhin')).getByText('Needs re-check')).toBeTruthy();
  });

  it('omits links to unpublished findings', () => {
    renderClient('use=find-endpoint');
    expect(screen.getByRole('link', { name: 'Published finding link' }).getAttribute('href')).toBe(
      '/findings/endpoint-url-validity',
    );
    expect(screen.queryByText('Unpublished finding link')).toBeNull();
  });

  it('tags a basic-level network on a route card as use-case detail pending', () => {
    const basic = {
      id: 'nj-multi',
      name: 'Example NJ Multi-state',
      type: 'multi_state' as const,
      national: false,
      states: ['NJ'],
      detail_level: 'basic' as const,
      routes: [],
      website: 'https://example.org/nj',
      how_to_join: 'Contact the network.',
      sources: [src('https://example.org/nj')],
      last_checked: '2026-10-15',
    };
    renderClient('', { ...fixture, networks: [...fixture.networks, basic] });
    fireEvent.click(screen.getByTestId('cell-NJ'));
    const card = screen.getByTestId('route-tr-hie');
    expect(within(within(card).getByTestId('network-nj-multi')).getByText('use-case detail pending')).toBeTruthy();
    expect(within(within(card).getByTestId('network-old-qhin')).queryByText('use-case detail pending')).toBeNull();
    const panel = screen.getByTestId('state-panel');
    expect(within(within(panel).getByTestId('network-nj-multi')).queryByText('use-case detail pending')).toBeNull();
  });

  it('lists sources and freshness with a link to the JSON', () => {
    renderClient();
    const s = screen.getByTestId('sources-freshness');
    expect(within(s).getByText(/Oldest last-checked date on this page: 2026-01-01/)).toBeTruthy();
    expect(within(s).getByRole('link', { name: '/api/v1/networks.json' }).getAttribute('href')).toBe(
      '/api/v1/networks.json',
    );
    expect(within(s).getAllByRole('link').length).toBeGreaterThanOrEqual(5);
  });

  it('renders a non-https source as plain text, never as an anchor', () => {
    const { container } = renderClient('use=public-health');
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect((a.getAttribute('href') ?? '').toLowerCase()).not.toContain('javascript:');
    }
    const titles = screen.getAllByText('Hostile source');
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t.closest('a')).toBeNull();
  });

  it('shows the disclaimer', () => {
    renderClient();
    expect(
      screen.getByText(
        'Educational resource, not legal advice and not an endorsement. AINPI is independent; no network, state agency or CMS reviewed or produced this page. Confirm details with the network before relying on them.',
      ),
    ).toBeTruthy();
  });

  it('contains no em dash in any text node', () => {
    const { container } = renderClient();
    fireEvent.click(screen.getByTestId('cell-PA'));
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) expect(n.textContent ?? '').not.toContain('—');
  });
});
