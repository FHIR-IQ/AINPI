import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// A rendered /npi/[npi] page carries the prefilled removal link.
// Synthetic NPI and name; no data files or database are read.
vi.mock('@/components/Navbar', () => ({ default: () => <nav /> }));
vi.mock('@/components/InlineSubscribe', () => ({ default: () => <div /> }));
vi.mock('@/lib/load-npi-cohort', () => ({
  publishedCohortNpis: async () => ['1234567893'],
  getPublishedCohortRow: async (npi: string) =>
    npi === '1234567893'
      ? {
          npi,
          name: 'EXAMPLE, TEST',
          state: 'ZZ',
          score: '1.5',
          bucket: 'critical',
          reasons: ['oig_excluded'],
          leie_excldate: '2001-01-01',
          sam_active_date: '',
          nppes_deactivation_date: '',
        }
      : null,
}));

import NpiReportCardPage from '@/app/npi/[npi]/page';

describe('/npi/[npi] page', () => {
  it('links to the removal form with the NPI prefilled', async () => {
    render(await NpiReportCardPage({ params: { npi: '1234567893' } }));
    const a = screen.getByRole('link', { name: 'Request removal of this page' });
    expect(a.getAttribute('href')).toBe('/privacy/remove?npi=1234567893');
  });
});
