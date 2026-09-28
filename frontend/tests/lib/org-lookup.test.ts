// @vitest-environment node
/**
 * org-lookup: the pure half of the MCP `lookup_organization` tool.
 *
 * Fixtures are inline and fictional: example.com URLs, invented names, and
 * NPIs that pass the 80840-prefixed Luhn check but belong to nobody.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  VENDOR_CLAIM_LABEL,
  OrgLookupSourceError,
  buildOrgIndex,
  createOrgIndexLoader,
  lookupOrganization,
  normalizeUrl,
  parseCsv,
} from '@/lib/org-lookup';
import { CURRENT_RELEASE } from '@/lib/release';

const NPI_A = '1234567893'; // in both sources
const NPI_B = '1234567901'; // NDH only
const NPI_C = '1234567919'; // vendor file only
const NPI_MISSING = '1234567927';

const CROSSWALK = [
  'endpoint_id,base_url,host,status,org_id,org_npi,org_name,org_state',
  // Same endpoint as the vendor row below, differing only in host case and a
  // trailing slash: must collapse to one entry.
  `Endpoint-1,https://FHIR.Example.com/Clinic/A/r4/,fhir.example.com,active,Organization-${NPI_A},${NPI_A},EXAMPLE CLINIC INC,KS`,
  // NDH-only endpoint for NPI_A, absent from the vendor file: vendor is null.
  `Endpoint-2,https://other.example.com/fhir,other.example.com,active,Organization-${NPI_A},${NPI_A},EXAMPLE CLINIC INC,KS`,
  // NPI_B: endpoint the vendor file names, but for a different (or no) NPI,
  // so the vendor name is known while the attribution stays NDH-only.
  `Endpoint-3,https://ehr.example.com/b/r4,ehr.example.com,active,Organization-${NPI_B},${NPI_B},SAMPLE HEALTH,`,
].join('\n');

const VENDOR = [
  'url,org_name,org_npi,vendor,in_ndh,ndh_has_owner',
  `https://fhir.example.com/Clinic/A/r4,"Example Clinic, Inc",${NPI_A},Acme EHR,yes,yes`,
  // Vendor-only endpoint for NPI_A.
  `https://portal.example.com/a/fhir,"Example Clinic, Inc",${NPI_A},Acme EHR,no,`,
  // No NPI: indexable by URL only.
  'https://ehr.example.com/b/r4,"Sample ""Main"" Office",,Beta EHR,yes,no',
  // NPI_C: vendor file only.
  `https://c.example.com/fhir,Test Practice LLC,${NPI_C},Beta EHR,yes,no`,
].join('\n');

const LINKAGE = JSON.stringify({
  slug: 'endpoint-org-linkage',
  hypotheses: ['H50'],
  release_date: '2026-08-20',
  numerator: 200,
  denominator: 1000,
});

function index() {
  return buildOrgIndex({ crosswalkCsv: CROSSWALK, vendorCsv: VENDOR, linkageJson: LINKAGE });
}

describe('normalizeUrl', () => {
  it('lower-cases scheme and host, strips trailing slashes, keeps path case', () => {
    expect(normalizeUrl('HTTPS://Fhir.Example.COM/Path/EBAEAA///')).toBe(
      'https://fhir.example.com/Path/EBAEAA',
    );
  });
  it('keeps query and fragment as published', () => {
    expect(normalizeUrl('https://A.example.com/x/?Q=1#Frag')).toBe(
      'https://a.example.com/x?Q=1#Frag',
    );
  });
  it('does not add a slash to an empty path', () => {
    expect(normalizeUrl('https://Example.com')).toBe('https://example.com');
    expect(normalizeUrl('https://Example.com/')).toBe('https://example.com');
  });
  it('returns null for empty input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('handles quoted commas and doubled quotes', () => {
    const rows = parseCsv('a,b,c\n"x, y","say ""hi""",3\n');
    expect(rows).toEqual([{ a: 'x, y', b: 'say "hi"', c: '3' }]);
  });
  it('tolerates CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });
});

describe('buildOrgIndex', () => {
  it('refuses a crosswalk that is missing its columns (no silent zero)', () => {
    expect(() =>
      buildOrgIndex({ crosswalkCsv: 'foo,bar\n1,2', vendorCsv: VENDOR, linkageJson: LINKAGE }),
    ).toThrow(OrgLookupSourceError);
  });
  it('refuses an empty vendor file', () => {
    expect(() =>
      buildOrgIndex({
        crosswalkCsv: CROSSWALK,
        vendorCsv: 'url,org_name,org_npi,vendor,in_ndh,ndh_has_owner\n',
        linkageJson: LINKAGE,
      }),
    ).toThrow(OrgLookupSourceError);
  });
});

describe('lookupOrganization', () => {
  it('merges both sources and de-duplicates by normalized URL', () => {
    const r = lookupOrganization(index(), NPI_A);
    expect(r.found).toBe(true);
    expect(r.release_date).toBe(CURRENT_RELEASE);
    expect(r.state).toBe('KS');
    expect(r.names).toEqual([
      { name: 'EXAMPLE CLINIC INC', source: 'ndh' },
      { name: 'Example Clinic, Inc', source: 'vendor_file' },
    ]);
    expect(r.endpoints).toHaveLength(3);

    const shared = r.endpoints.find((e) => e.base_url === 'https://FHIR.Example.com/Clinic/A/r4/')!;
    // The NDH record wins the primary label and keeps its URL as published.
    expect(shared.source).toBe('ndh');
    expect(shared.sources).toEqual(['ndh', 'vendor_file']);
    expect(shared.base_url).toBe('https://FHIR.Example.com/Clinic/A/r4/');
    expect(shared.vendor).toBe('Acme EHR');
    expect(shared.ndh).toEqual({ endpoint_id: 'Endpoint-1', status: 'active' });
    expect(shared.vendor_file).toMatchObject({
      label: VENDOR_CLAIM_LABEL,
      in_ndh: true,
      ndh_has_owner: true,
    });
  });

  it('labels vendor-only endpoints as the vendor claim, not CMS data', () => {
    const r = lookupOrganization(index(), NPI_A);
    const vOnly = r.endpoints.find((e) => e.base_url === 'https://portal.example.com/a/fhir')!;
    expect(vOnly.source).toBe('vendor_file');
    expect(vOnly.sources).toEqual(['vendor_file']);
    expect(vOnly.ndh).toBeNull();
    expect(vOnly.vendor_file?.label).toMatch(/not CMS data/i);
    expect(vOnly.vendor_file?.in_ndh).toBe(false);
    expect(vOnly.vendor_file?.ndh_has_owner).toBeNull();
  });

  it('returns a null vendor for an NDH endpoint no vendor file names', () => {
    const r = lookupOrganization(index(), NPI_A);
    const e = r.endpoints.find((x) => x.base_url === 'https://other.example.com/fhir')!;
    expect(e.source).toBe('ndh');
    expect(e.vendor).toBeNull();
    expect(e.vendor_file).toBeNull();
  });

  it('reports no single state when crosswalk rows disagree', () => {
    const cw = CROSSWALK + `\nEndpoint-9,https://x.example.com/r4,x.example.com,active,Organization-${NPI_A},${NPI_A},EXAMPLE CLINIC INC,MO`;
    const idx = buildOrgIndex({ crosswalkCsv: cw, vendorCsv: VENDOR, linkageJson: LINKAGE });
    const r = lookupOrganization(idx, NPI_A);
    expect(r.state).toBeNull();
    expect(r.states).toEqual(['KS', 'MO']);
  });

  it('names the vendor for an NDH endpoint the vendor file lists under no NPI', () => {
    const r = lookupOrganization(index(), NPI_B);
    expect(r.state).toBeNull();
    expect(r.endpoints).toHaveLength(1);
    expect(r.endpoints[0]).toMatchObject({ source: 'ndh', sources: ['ndh'], vendor: 'Beta EHR' });
  });

  it('serves an NPI found only in the vendor file', () => {
    const r = lookupOrganization(index(), NPI_C);
    expect(r.found).toBe(true);
    expect(r.state).toBeNull();
    expect(r.names).toEqual([{ name: 'Test Practice LLC', source: 'vendor_file' }]);
    expect(r.endpoints[0].source).toBe('vendor_file');
  });

  it('returns an explicit not-found result citing the H50 figure', () => {
    const r = lookupOrganization(index(), NPI_MISSING);
    expect(r.found).toBe(false);
    expect(r.endpoints).toEqual([]);
    expect(r.notes).toMatch(/not found in either source/i);
    expect(r.notes).toContain('200 of 1,000');
    expect(r.notes).toContain('20.0%');
    expect(r.notes).toContain('H50');
  });

  it('still answers not-found when the H50 figure could not be read', () => {
    const idx = buildOrgIndex({ crosswalkCsv: CROSSWALK, vendorCsv: VENDOR, linkageJson: null });
    const r = lookupOrganization(idx, NPI_MISSING);
    expect(r.found).toBe(false);
    expect(r.notes).toMatch(/minority/);
  });
});

describe('createOrgIndexLoader', () => {
  function fakeFetch(fail: Set<string> = new Set()) {
    return vi.fn(async (url: string) => {
      for (const f of fail) if (url.includes(f)) throw new Error(`${url} returned 503`);
      if (url.includes('endpoint-org-crosswalk.csv')) return CROSSWALK;
      if (url.includes('vendor-endpoint-attribution.csv')) return VENDOR;
      if (url.includes('endpoint-org-linkage.json')) return LINKAGE;
      throw new Error(`unexpected ${url}`);
    });
  }

  it('fetches once, then serves from memory within the TTL', async () => {
    let t = 0;
    const fetchText = fakeFetch();
    const load = createOrgIndexLoader({ base: 'https://example.com', fetchText, now: () => t, ttlMs: 1000 });
    const [a, b] = await Promise.all([load(), load()]);
    expect(a.index).toBe(b.index);
    expect(fetchText).toHaveBeenCalledTimes(3);
    t = 500;
    await load();
    expect(fetchText).toHaveBeenCalledTimes(3);
    t = 2000;
    await load();
    expect(fetchText).toHaveBeenCalledTimes(6);
  });

  it('throws a source error, never an empty index, when a CSV fetch fails cold', async () => {
    const load = createOrgIndexLoader({
      base: 'https://example.com',
      fetchText: fakeFetch(new Set(['vendor-endpoint-attribution.csv'])),
      now: () => 0,
      ttlMs: 1000,
    });
    await expect(load()).rejects.toBeInstanceOf(OrgLookupSourceError);
  });

  it('degrades only the H50 sentence when the linkage JSON fails', async () => {
    const load = createOrgIndexLoader({
      base: 'https://example.com',
      fetchText: fakeFetch(new Set(['endpoint-org-linkage.json'])),
      now: () => 0,
      ttlMs: 1000,
    });
    const { index: idx } = await load();
    expect(idx.h50).toBeNull();
    expect(lookupOrganization(idx, NPI_A).found).toBe(true);
  });

  it('serves the previous index, marked stale, when a refresh fails', async () => {
    let t = 0;
    let broken = false;
    const ok = fakeFetch();
    const fetchText = vi.fn(async (url: string) => {
      if (broken) throw new Error('503');
      return ok(url);
    });
    const load = createOrgIndexLoader({ base: 'https://example.com', fetchText, now: () => t, ttlMs: 1000 });
    const first = await load();
    expect(first.stale).toBe(false);
    broken = true;
    t = 5000;
    const second = await load();
    expect(second.stale).toBe(true);
    expect(second.index).toBe(first.index);
    // Backs off: no refetch until another TTL has passed.
    const calls = fetchText.mock.calls.length;
    t = 5500;
    await load();
    expect(fetchText.mock.calls.length).toBe(calls);
    const r = lookupOrganization(second.index, NPI_A, { stale: true });
    expect(r.notes).toMatch(/stale/i);
  });
});
