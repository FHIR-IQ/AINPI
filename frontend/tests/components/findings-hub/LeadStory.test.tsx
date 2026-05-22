import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadStory } from '@/components/findings-hub/LeadStory';
import type { LeadStoryItem } from '@/lib/hub-feed';

const lead: LeadStoryItem = {
  date: '2026-05-22',
  category: 'finding',
  status: 'published',
  title: '$880K Medicare billing 8 years post-exclusion',
  summary: 'H40 surfaced 4 candidates; primary-source verification confirms 1.',
  href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
  heroStats: [
    { label: 'Confirmed cases', value: '1' },
    { label: 'CY 2023 paid', value: '$880K' },
  ],
  verifyChips: [
    { label: 'LEIE', url: 'https://exclusions.oig.hhs.gov/' },
    { label: 'NPPES', url: 'https://npiregistry.cms.hhs.gov/' },
  ],
  ctaLabel: 'Open finding →',
  ctaHref: '/findings/excluded-billing-medicare-partb-by-hcpcs',
};

describe('LeadStory', () => {
  it('renders the headline title as an <h1>', () => {
    render(<LeadStory item={lead} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toContain('$880K Medicare billing');
  });

  it('renders the summary', () => {
    render(<LeadStory item={lead} />);
    expect(screen.getByText(/H40 surfaced 4 candidates/)).toBeInTheDocument();
  });

  it('renders heroStats as label/value pairs', () => {
    render(<LeadStory item={lead} />);
    expect(screen.getByText('Confirmed cases')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('CY 2023 paid')).toBeInTheDocument();
    expect(screen.getByText('$880K')).toBeInTheDocument();
  });

  it('renders verify chips as external links with rel=noopener', () => {
    render(<LeadStory item={lead} />);
    const leieLink = screen.getByRole('link', { name: 'LEIE' });
    expect(leieLink).toHaveAttribute('href', 'https://exclusions.oig.hhs.gov/');
    expect(leieLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders the CTA button linking to ctaHref', () => {
    render(<LeadStory item={lead} />);
    const cta = screen.getByRole('link', { name: 'Open finding →' });
    expect(cta).toHaveAttribute('href', '/findings/excluded-billing-medicare-partb-by-hcpcs');
  });

  it('omits the stat row when heroStats is absent', () => {
    const minimal = { ...lead, heroStats: undefined };
    render(<LeadStory item={minimal} />);
    expect(screen.queryByText('Confirmed cases')).not.toBeInTheDocument();
  });

  it('renders the lead date in human-readable format', () => {
    render(<LeadStory item={lead} />);
    expect(screen.getByText(/May 22, 2026/)).toBeInTheDocument();
  });
});
