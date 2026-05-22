import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Timeline } from '@/components/findings-hub/Timeline';
import type { TimelineEntry } from '@/lib/hub-feed';

const entries: TimelineEntry[] = [
  {
    date: '2026-05-22',
    category: 'finding',
    status: 'published',
    title: 'H40 published',
    summary: '$880K case.',
    href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
    hNumbers: ['H40'],
  },
  {
    date: '2026-05-22',
    category: 'article',
    title: 'Eight years post-exclusion',
    summary: 'Long-form.',
    href: '/articles/eight-years-post-exclusion',
  },
  {
    date: '2026-05-18',
    category: 'finding',
    status: 'published',
    title: 'H37 published',
    summary: '508K PECOS taxonomy mismatches.',
    href: '/findings/pecos-taxonomy-disagreement',
    hNumbers: ['H37'],
  },
];

describe('Timeline', () => {
  it('renders one row per entry as an ordered list', () => {
    const { container } = render(<Timeline entries={entries} />);
    const list = container.querySelector('ol');
    expect(list).toBeInTheDocument();
    expect(list?.children.length).toBe(entries.length);
  });

  it('renders the section header "Recent updates"', () => {
    render(<Timeline entries={entries} />);
    expect(screen.getByText(/Recent updates/i)).toBeInTheDocument();
  });

  it('renders a subscribe link to /subscribe', () => {
    render(<Timeline entries={entries} />);
    const link = screen.getByRole('link', { name: /Subscribe/i });
    expect(link).toHaveAttribute('href', '/subscribe');
  });

  it('handles empty entries gracefully with a placeholder', () => {
    render(<Timeline entries={[]} />);
    expect(screen.getByText(/No recent updates/i)).toBeInTheDocument();
  });
});
