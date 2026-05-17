import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MetricSwitcher from '@/components/homepage/MetricSwitcher';
import type { MapMetric } from '@/lib/homepage-data';

const METRICS: MapMetric[] = [
  { slug: 'cohortSize', label: 'Cohort size', description: '', unit: 'count' },
  { slug: 'strictPostExclusion', label: 'Strict post', description: '', unit: 'count' },
  { slug: 'deactivatedStillBilling', label: 'Deactivated', description: '', unit: 'count' },
];

describe('MetricSwitcher', () => {
  it('renders one chip per metric', () => {
    render(<MetricSwitcher metrics={METRICS} value="cohortSize" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cohort size/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /strict post/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deactivated/i })).toBeInTheDocument();
  });

  it('marks the selected chip with aria-pressed', () => {
    render(<MetricSwitcher metrics={METRICS} value="strictPostExclusion" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /strict post/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /cohort size/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onChange with the slug of the clicked metric', () => {
    const onChange = vi.fn();
    render(<MetricSwitcher metrics={METRICS} value="cohortSize" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /deactivated/i }));
    expect(onChange).toHaveBeenCalledWith('deactivatedStillBilling');
  });
});
