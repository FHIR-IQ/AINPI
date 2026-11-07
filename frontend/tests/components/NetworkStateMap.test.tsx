import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import NetworkStateMap from '@/components/charts/NetworkStateMap';

const topo = {
  type: 'Topology',
  arcs: [
    [[-78, 40], [-78, 41], [-77, 41], [-77, 40], [-78, 40]],
    [[-81, 40], [-81, 41], [-80, 41], [-80, 40], [-81, 40]],
    [[-66.5, 18], [-66.5, 18.4], [-66, 18.4], [-66, 18], [-66.5, 18]],
  ],
  objects: {
    states: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', id: '42', arcs: [[0]] },
        { type: 'Polygon', id: '39', arcs: [[1]] },
        // Puerto Rico: outside geoAlbersUsa, so it has no drawable path.
        { type: 'Polygon', id: '72', arcs: [[2]] },
      ],
    },
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Cells = Record<string, { category: 'none' | 'hidden' | 'state_hie' | 'multi_state' | 'both'; verified: boolean }>;

function setup(
  selected: string | null,
  ok = true,
  cells: Cells = { PA: { category: 'both', verified: true }, OH: { category: 'none', verified: true } },
) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(topo) }));
  return render(<NetworkStateMap title="Map" selectedState={selected} onStateClick={() => {}} cells={cells} />);
}

describe('NetworkStateMap outlines', () => {
  it('draws the selected outline last, non-interactive, with one button per state', async () => {
    const { container } = setup('PA');
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    const svg = container.querySelector('svg')!;
    const last = svg.lastElementChild!;
    expect(last.getAttribute('data-testid')).toBe('outline-layer');
    expect(last.querySelector('[data-outline="selected"]')).not.toBeNull();
    expect(screen.getByLabelText(/Pennsylvania/).getAttribute('aria-pressed')).toBe('true');
  });

  it('adds a focus outline on top when a state is focused', async () => {
    const { container } = setup(null);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    fireEvent.focus(screen.getByLabelText(/Ohio/));
    expect(container.querySelector('[data-outline="focus"]')).not.toBeNull();
  });
});

describe('NetworkStateMap drawing', () => {
  it('draws no path for a feature the projection cannot place', async () => {
    const { container } = setup(null);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    const fills = Array.from(container.querySelectorAll('svg > g:not([data-testid]) > path'));
    expect(fills).toHaveLength(2);
    for (const p of fills) expect(p.getAttribute('d')).toBeTruthy();
  });

  it('insets the drawing so edge outlines are not clipped', async () => {
    const { container } = setup('PA');
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    const nums = Array.from(container.querySelectorAll('svg path[aria-label]'))
      .flatMap((p) => (p.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g) ?? [])
      .map(Number);
    expect(nums.length).toBeGreaterThan(0);
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(3.99);
    expect(Math.max(...nums)).toBeLessThanOrEqual(956.01);
  });

  it('shows the error message when the topology request fails', async () => {
    setup(null, false);
    await waitFor(() => expect(screen.getByText('The map could not be loaded.')).toBeTruthy());
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('labels a state hidden by the overlay filter as hidden, not as having no network', async () => {
    const { container } = setup(null, true, {
      PA: { category: 'hidden', verified: true },
      OH: { category: 'none', verified: true },
    });
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    const pa = screen.getByRole('button', { name: /^Pennsylvania:/ });
    expect(pa.getAttribute('aria-label')).toBe('Pennsylvania: Hidden by current filters');
    expect(pa.getAttribute('fill')).toBe('url(#nm-hidden)');
    expect(container.querySelector('pattern#nm-hidden')).not.toBeNull();
    expect(screen.getByRole('button', { name: /^Ohio:/ }).getAttribute('aria-label')).toBe(
      'Ohio: No state or multi-state network for this use case in our sources',
    );
    expect(screen.getByText('Hidden by current filters')).toBeTruthy();
  });

  it('omits the hidden legend row when no state is hidden', async () => {
    setup(null);
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
    expect(screen.queryByText('Hidden by current filters')).toBeNull();
  });
});
