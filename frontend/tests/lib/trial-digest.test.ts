import { describe, expect, it } from 'vitest';
import { loadTrialCounts, renderTrialHtml, renderTrialText, type TrialCountsDb } from '@/lib/trial-digest';

const now = new Date('2026-11-23T12:00:00Z');
const since7 = new Date('2026-11-16T12:00:00Z');
const since30 = new Date('2026-10-24T12:00:00Z');

function db(over: Partial<TrialCountsDb> = {}): TrialCountsDb {
  return {
    trialSignup: {
      count: async (a) => ('createdAt' in (a?.where ?? {}) ? 2 : 3),
      findMany: async () => [{ apiKeyId: 'k-trial-1' }, { apiKeyId: 'k-trial-2' }, { apiKeyId: null }],
    },
    rosterVerification: {
      findMany: async () => [
        { keyId: 'k-trial-1', npiCount: 3 },
        { keyId: 'k-trial-1', npiCount: 25 },
        { keyId: 'k-trial-2', npiCount: 10 },
        { keyId: 'k-partner', npiCount: 200 },
      ],
    },
    ...over,
  };
}

describe('loadTrialCounts', () => {
  it('counts trial keys verifying and those with a real batch, ignoring other tiers', async () => {
    const c = await loadTrialCounts(db(), since7, since30, now);
    expect(c).toEqual({
      status: 'ok',
      started: 2,
      live: 3,
      trialKeysVerifying: 2,
      trialKeysRealBatch: 1,
      rosterCalls: 4,
      rosterNpis: 238,
    });
  });

  it('reads unavailable, never throws, when a table is missing', async () => {
    const broken = db({
      rosterVerification: {
        findMany: async () => {
          throw new Error('relation "roster_verifications" does not exist');
        },
      },
    });
    const c = await loadTrialCounts(broken, since7, since30, now);
    expect(c.status).toBe('unavailable');
    expect(renderTrialText(c)).toMatch(/unavailable/);
    expect(renderTrialHtml(c)).toMatch(/Unavailable/);
  });

  it('renders counts only', async () => {
    const c = await loadTrialCounts(db(), since7, since30, now);
    const text = renderTrialText(c) + renderTrialHtml(c);
    expect(text).not.toMatch(/k-trial|@/);
    expect(text).toMatch(/25 or more/);
  });
});
