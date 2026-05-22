import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineEntryRow } from '@/components/findings-hub/TimelineEntry';
import type { TimelineEntry } from '@/lib/hub-feed';

const sample: TimelineEntry = {
  date: '2026-05-22',
  category: 'finding',
  status: 'published',
  title: 'H40 published',
  summary: '$880K Medicare billing 8 years post-exclusion.',
  href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
  hNumbers: ['H40'],
};

describe('TimelineEntryRow', () => {
  it('renders date in MMM DD format', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText('May 22')).toBeInTheDocument();
  });

  it('renders title as a link to the entry href', () => {
    render(<TimelineEntryRow entry={sample} />);
    const link = screen.getByRole('link', { name: /H40 published/ });
    expect(link).toHaveAttribute('href', '/findings/excluded-billing-medicare-partb-by-hcpcs');
  });

  it('renders summary text', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText(/\$880K Medicare billing/)).toBeInTheDocument();
  });

  it('renders the category chip with the correct text', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText(/Finding/i)).toBeInTheDocument();
  });

  it('renders StatusPill when entry has a status', () => {
    render(<TimelineEntryRow entry={sample} />);
    expect(screen.getByText('PUB')).toBeInTheDocument();
  });

  it('renders an article entry without a status pill', () => {
    const article: TimelineEntry = {
      date: '2026-05-22',
      category: 'article',
      title: 'Eight years post-exclusion',
      summary: 'Long-form companion to H40.',
      href: '/articles/eight-years-post-exclusion',
    };
    render(<TimelineEntryRow entry={article} />);
    expect(screen.queryByText('PUB')).not.toBeInTheDocument();
    expect(screen.getByText(/Article/i)).toBeInTheDocument();
  });
});
