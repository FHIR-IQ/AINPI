import { describe, expect, it } from 'vitest';

import { buildOrgIndex } from '@/lib/org-lookup';
import {
  assemble,
  invalidResult,
  parseRoster,
  rosterUnits,
  samNameMatches,
  summarize,
  type NppesResult,
  type WarehouseRow,
} from '@/lib/roster';
import { parseNppes } from '@/lib/roster-sources';

// Synthetic, check-digit-valid NPIs (never real people in tests).
const P = '1234567893';
const O = '1245319599';
const BAD = '1234567890';

const NPPES_P: NppesResult = {
  checked: true, found: true, enumeration_type: 'NPI-1', status: 'A', name: 'PAT EXAMPLE',
  last_name: 'EXAMPLE', first_name: 'PAT', primary_taxonomy: { code: '207R00000X', desc: 'Internal Medicine' }, last_updated: '2025-01-01',
};
const NPPES_O: NppesResult = {
  checked: true, found: true, enumeration_type: 'NPI-2', status: 'A', name: 'ACME CLINIC LLC',
  last_name: null, first_name: null, primary_taxonomy: null, last_updated: null,
};

const row = (over: Partial<WarehouseRow> = {}): WarehouseRow => ({
  npi: P,
  prac: { active: true, family: 'EXAMPLE', given: 'PAT', state: 'PA' },
  org: null,
  roles: { active_roles: 2, org_refs: [`Organization/Organization-${O}`] },
  leie: null,
  sam: null,
  ...over,
});

const CROSSWALK = 'endpoint_id,base_url,status,org_id,org_npi,org_name,org_state\n' +
  `e1,https://fhir.acme.example/r4,active,Organization-${O},${O},ACME CLINIC,PA\n`;
const VENDOR = 'url,org_name,org_npi,vendor,in_ndh,ndh_has_owner,npis_on_url\n' +
  `https://wide.example/r4,BIG BRAND,${O},EpicLike,no,no,40\n`;
const index = buildOrgIndex({ crosswalkCsv: CROSSWALK, vendorCsv: VENDOR, linkageJson: null });

describe('parseRoster', () => {
  it('dedupes, separates bad check digits, and enforces the tier limit', () => {
    const r = parseRoster([P, P, BAD, Number(O)], 25);
    expect(r).toEqual({ ok: true, npis: [P, O], invalid: [BAD], duplicates: 1 });
    expect(parseRoster(Array(26).fill(0).map((_, i) => String(1000000000 + i)), 25).ok).toBe(false);
  });
  it('rejects anything that is not ten digits, and an empty list', () => {
    expect(parseRoster(['123'], 25).ok).toBe(false);
    expect(parseRoster(['Pat Example'], 25).ok).toBe(false);
    expect(parseRoster([], 25).ok).toBe(false);
    expect(parseRoster('1234567893', 25).ok).toBe(false);
  });
  it('charges a base plus two units per NPI', () => {
    expect(rosterUnits(25)).toBe(55);
  });
});

describe('assemble', () => {
  it('a clean practitioner: found everywhere, reachable through a deterministic endpoint', () => {
    const r = assemble({ npi: P, row: row(), nppes: NPPES_P, index, suppressed: false });
    expect(r.directory).toMatchObject({ found: true, kind: 'practitioner', active_roles: 2, linked_organizations: 1 });
    expect(r.endpoint.reachable).toBe(true);
    expect(r.endpoint.endpoints[0]).toMatchObject({ org_npi: O, source: 'ndh' });
    expect(r.flags).toEqual([]);
  });

  it('does not count a practice-wide vendor list as reach', () => {
    // A crosswalk that names some other organization, so this one has only the wide vendor list.
    const cw = 'endpoint_id,base_url,status,org_id,org_npi,org_name,org_state\n' +
      'e9,https://other.example/r4,active,Organization-1234567893,1234567893,OTHER,PA\n';
    const idx = buildOrgIndex({ crosswalkCsv: cw, vendorCsv: VENDOR, linkageJson: null });
    const r = assemble({ npi: P, row: row(), nppes: NPPES_P, index: idx, suppressed: false });
    expect(r.endpoint).toMatchObject({ reachable: false, practice_wide_only: true });
    expect(r.flags).toContain('no_endpoint');
  });

  it('flags an OIG exclusion and a SAM match whose name agrees with NPPES', () => {
    const r = assemble({
      npi: P,
      row: row({
        leie: { excldate: '20180101', excltype: '1128a1' },
        sam: { active_date: '2019-01-01', name: null, first_name: 'Pat', last_name: 'Example', agency: 'HHS' },
      }),
      nppes: NPPES_P, index, suppressed: false,
    });
    expect(r.flags).toEqual(expect.arrayContaining(['oig_excluded', 'sam_excluded']));
    expect(r.exclusions.sam.needs_review).toBe(false);
  });

  it('marks a SAM match on another name as needs_review, never a plain exclusion', () => {
    const r = assemble({
      npi: P,
      row: row({ sam: { active_date: '2019-01-01', name: null, first_name: 'Chris', last_name: 'Other', agency: 'OPM' } }),
      nppes: NPPES_P, index, suppressed: false,
    });
    expect(r.flags).toContain('sam_excluded_needs_review');
    expect(r.flags).not.toContain('sam_excluded');
  });

  it('a failed NPPES call reads "not checked", never "not in NPPES"', () => {
    const r = assemble({ npi: P, row: row(), nppes: { checked: false }, index, suppressed: false });
    expect(r.flags).toContain('nppes_not_checked');
    expect(r.flags).not.toContain('not_in_nppes');
  });

  it('a failed warehouse query reads "not checked" for the directory and exclusions', () => {
    const r = assemble({ npi: P, row: null, nppes: NPPES_P, index, suppressed: false });
    expect(r.flags).toEqual(expect.arrayContaining(['directory_not_checked', 'exclusions_not_checked']));
    expect(r.exclusions.checked).toBe(false);
  });

  it('an organization NPI uses its own endpoints', () => {
    const r = assemble({
      npi: O, row: row({ npi: O, prac: null, roles: null, org: { active: true, name: 'ACME CLINIC', state: 'PA' } }),
      nppes: NPPES_O, index, suppressed: false,
    });
    expect(r.directory.kind).toBe('organization');
    expect(r.endpoint.reachable).toBe(true);
  });

  it('a practitioner with no roles and no record elsewhere is flagged accordingly', () => {
    const r = assemble({ npi: P, row: row({ prac: null, roles: null }), nppes: { checked: true, found: false }, index, suppressed: false });
    expect(r.flags).toEqual(expect.arrayContaining(['not_in_nppes', 'not_in_ndh']));
  });

  it('a suppressed NPI returns nothing from any source', () => {
    const r = assemble({ npi: P, row: row({ leie: { excldate: '20180101', excltype: 'x' } }), nppes: NPPES_P, index, suppressed: true });
    expect(r.flags).toEqual(['not_checked']);
    expect(r.directory.found).toBe(false);
    expect(r.nppes.checked).toBe(false);
    expect(r.exclusions.oig_leie.excluded).toBe(false);
  });
});

describe('samNameMatches', () => {
  it('compares organizations on normalized names', () => {
    const sam = { active_date: 'x', name: 'Acme Clinic, L.L.C.', first_name: null, last_name: null, agency: null };
    expect(samNameMatches(sam, NPPES_O)).toBe(true);
    expect(samNameMatches({ ...sam, name: 'Other Corp' }, NPPES_O)).toBe(false);
    expect(samNameMatches(sam, { checked: false })).toBeNull();
  });
});

describe('summarize and invalid results', () => {
  it('counts action flags, not "not checked" ones', () => {
    const ok = assemble({ npi: P, row: row(), nppes: NPPES_P, index, suppressed: false });
    const unchecked = assemble({ npi: O, row: row(), nppes: { checked: false }, index, suppressed: false });
    const bad = invalidResult(BAD);
    const s = summarize([ok, unchecked, bad], 2);
    expect(s).toMatchObject({ submitted: 5, verified: 3, duplicates_removed: 2, flagged: 1 });
    expect(s.by_flag).toMatchObject({ invalid_check_digit: 1, nppes_not_checked: 1 });
  });
});

describe('parseNppes', () => {
  it('reads a found record and a deactivated or unknown one', () => {
    const found = parseNppes({
      result_count: 1,
      results: [{ enumeration_type: 'NPI-2', basic: { status: 'A', organization_name: 'ACME CLINIC LLC', last_updated: '2016-12-14' },
        taxonomies: [{ code: '3336C0003X', desc: 'Community/Retail Pharmacy', primary: true }] }],
    });
    expect(found).toMatchObject({ checked: true, found: true, enumeration_type: 'NPI-2', name: 'ACME CLINIC LLC', primary_taxonomy: { code: '3336C0003X' } });
    expect(parseNppes({ result_count: 0, results: [] })).toEqual({ checked: true, found: false });
    expect(parseNppes({ Errors: [{ description: 'x' }] })).toEqual({ checked: false });
    expect(parseNppes('nonsense')).toEqual({ checked: false });
  });
});
