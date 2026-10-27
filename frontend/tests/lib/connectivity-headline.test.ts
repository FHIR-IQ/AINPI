import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { loadConnectivityHeadline } from '@/lib/load-api-v1';

// The homepage and /states show these numbers. They must be the ledger's own.
describe('loadConnectivityHeadline', () => {
  it('formats the published PA ledger summary', () => {
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../../public/api/v1/states/pa-connectivity.json'),
        'utf8',
      ),
    );
    const s = raw.summary;
    const h = loadConnectivityHeadline('pa');
    expect(h).not.toBeNull();
    expect(h?.practitioners).toBe(s.practitioners.toLocaleString('en-US'));
    expect(h?.withRolePct).toBe(`${s.with_role_pct.toFixed(1)}%`);
    expect(h?.reachPct).toBe(`${s.reaches_endpoint_pct.toFixed(1)}%`);
    expect(h?.deterministicPct).toBe(`${s.reaches_endpoint_deterministic_pct.toFixed(1)}%`);
  });

  // Practitioner state from the physical address since 2026-10-27 (FHI-84).
  it('matches the 2026-10-07 release values', () => {
    expect(loadConnectivityHeadline('pa')).toEqual({
      practitioners: '225,413',
      withRolePct: '43.4%',
      reachPct: '22.2%',
      deterministicPct: '2.8%',
    });
  });

  it('returns null for a state with no ledger', () => {
    expect(loadConnectivityHeadline('zz')).toBeNull();
  });
});
