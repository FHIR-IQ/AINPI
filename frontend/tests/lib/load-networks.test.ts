import { describe, expect, it } from 'vitest';

import { loadNetworks } from '@/lib/load-api-v1';

describe('loadNetworks', () => {
  it('returns the seven use cases in spec order', () => {
    const payload = loadNetworks();
    expect(payload).not.toBeNull();
    expect(payload!.use_cases.map((u) => u.slug)).toEqual([
      'treatment-records',
      'individual-access',
      'find-endpoint',
      'payer-exchange',
      'encounter-alerts',
      'public-health',
      'community-referral',
    ]);
  });
});
