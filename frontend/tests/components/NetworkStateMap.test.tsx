import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import NetworkStateMap from '@/components/charts/NetworkStateMap';

const topo = {
  type: 'Topology',
  arcs: [
    [[-78, 40], [-78, 41], [-77, 41], [-77, 40], [-78, 40]],
    [[-81, 40], [-81, 41], [-80, 41], [-80, 40], [-81, 40]],
  ],
  objects: {
    states: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', id: '42', arcs: [[0]] },
        { type: 'Polygon', id: '39', arcs: [[1]] },
      ],
    },
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(selected: string | null) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve(topo) }));
  return render(
    <NetworkStateMap
      title="Map"
      selectedState={selected}
      onStateClick={() => {}}
      cells={{ PA: { category: 'both', verified: true }, OH: { category: 'none', verified: true } }}
    />,
  );
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
