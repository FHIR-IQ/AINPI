import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HubFeed } from '@/lib/hub-feed';

// Mock Navbar (uses Next.js useRouter — not available in jsdom)
vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

// Mock loadHubFeed to avoid filesystem reads at test time
const mockFeed: HubFeed = {
  lead: {
    date: '2026-05-22',
    category: 'finding',
    status: 'published',
    title: 'Test finding headline',
    summary: 'Summary of the lead finding.',
    href: '/findings/test-slug',
    ctaLabel: 'Open finding →',
    ctaHref: '/findings/test-slug',
  },
  timeline: [
    {
      date: '2026-05-20',
      category: 'finding',
      status: 'published',
      title: 'Another finding',
      summary: 'Another summary.',
      href: '/findings/another-slug',
    },
  ],
  catalog: [
    {
      hNumber: 'H1',
      title: 'Endpoint liveness',
      slug: 'endpoint-liveness',
      updated: '2026-05-20',
      status: 'published',
    },
    {
      hNumber: 'H9',
      title: 'NPI taxonomy correctness',
      slug: 'npi-taxonomy-correctness',
      updated: '2026-05-18',
      status: 'published',
    },
  ],
};

vi.mock('@/lib/hub-feed', () => ({
  loadHubFeed: () => mockFeed,
}));

import FindingsHub from '@/app/findings/page';

describe('FindingsHub page', () => {
  it('renders the lead story, timeline, and catalog sections', () => {
    render(<FindingsHub />);
    // Lead's H1 is present (verifies <LeadStory> rendered)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Timeline section heading
    expect(screen.getByText(/Recent updates/i)).toBeInTheDocument();
    // Catalog section heading
    expect(screen.getByText(/All \d+ findings/)).toBeInTheDocument();
  });
});
