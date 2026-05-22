import { describe, it, expectTypeOf } from 'vitest';
import type {
  TimelineEntry,
  TimelineCategory,
  TimelineStatus,
  CatalogRow,
  LeadStoryItem,
  HubFeed,
} from '@/lib/hub-feed';

describe('hub-feed types', () => {
  it('TimelineEntry has the right shape', () => {
    const entry: TimelineEntry = {
      date: '2026-05-22',
      category: 'finding',
      status: 'published',
      title: 'H40 published',
      summary: '$880K post-exclusion billing',
      href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
      hNumbers: ['H40'],
    };
    expectTypeOf(entry.category).toEqualTypeOf<TimelineCategory>();
    expectTypeOf(entry.status).toEqualTypeOf<TimelineStatus | undefined>();
    expectTypeOf(entry.hNumbers).toEqualTypeOf<string[] | undefined>();
  });

  it('CatalogRow has the right shape', () => {
    const row: CatalogRow = {
      hNumber: 'H40',
      title: 'Federally excluded NPIs billing Medicare Part B by HCPCS',
      slug: 'excluded-billing-medicare-partb-by-hcpcs',
      updated: '2026-05-22',
      status: 'published',
    };
    expectTypeOf(row.status).toEqualTypeOf<TimelineStatus>();
    expectTypeOf(row).toMatchTypeOf<{ hNumber: string; title: string; slug: string; updated: string; status: TimelineStatus }>();
  });

  it('LeadStoryItem extends TimelineEntry with verify/stats/cta', () => {
    const lead: LeadStoryItem = {
      date: '2026-05-22',
      category: 'finding',
      status: 'published',
      title: '$880K Medicare billing 8 years post-exclusion',
      summary: 'H40 surfaced 4 candidates; primary-source verification confirms 1.',
      href: '/findings/excluded-billing-medicare-partb-by-hcpcs',
      verifyChips: [
        { label: 'LEIE', url: 'https://exclusions.oig.hhs.gov/' },
      ],
      heroStats: [{ label: 'Confirmed', value: '1' }],
      ctaLabel: 'Open finding →',
      ctaHref: '/findings/excluded-billing-medicare-partb-by-hcpcs',
    };
    expectTypeOf(lead).toMatchTypeOf<TimelineEntry>();
    expectTypeOf(lead.verifyChips).toEqualTypeOf<{ label: 'LEIE' | 'SAM' | 'NPPES'; url: string }[] | undefined>();
    expectTypeOf(lead.heroStats).toEqualTypeOf<{ label: string; value: string }[] | undefined>();
  });

  it('HubFeed bundles lead + timeline + catalog', () => {
    expectTypeOf<HubFeed>().toMatchTypeOf<{
      lead: LeadStoryItem;
      timeline: TimelineEntry[];
      catalog: CatalogRow[];
    }>();
  });
});
