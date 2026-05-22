import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomepageLatestStrip } from '@/components/findings-hub/HomepageLatestStrip';
import type { LeadStoryItem } from '@/lib/hub-feed';

const lead: LeadStoryItem = {
  date: '2026-05-22',
  category: 'finding',
  status: 'published',
  title: '$880K Medicare billing 8 years post-exclusion',
  summary: 'short summary',
  href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
  ctaLabel: 'Open finding →',
  ctaHref: '/findings/excluded-billing-medicare-partb-by-hcpcs',
};

describe('HomepageLatestStrip', () => {
  it('renders an eyebrow "Latest"', () => {
    render(<HomepageLatestStrip lead={lead} />);
    expect(screen.getByText(/^Latest$/i)).toBeInTheDocument();
  });

  it('renders the lead title', () => {
    render(<HomepageLatestStrip lead={lead} />);
    expect(screen.getByText(/\$880K Medicare billing/)).toBeInTheDocument();
  });

  it('renders the lead date in ISO format', () => {
    render(<HomepageLatestStrip lead={lead} />);
    expect(screen.getByText('2026-05-22')).toBeInTheDocument();
  });

  it('renders a "View all updates" link to /findings', () => {
    render(<HomepageLatestStrip lead={lead} />);
    const link = screen.getByRole('link', { name: /View all updates/i });
    expect(link).toHaveAttribute('href', '/findings');
  });
});
