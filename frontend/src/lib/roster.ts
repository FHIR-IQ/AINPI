/**
 * Roster verification: what the public federal sources say about each NPI in
 * a list. Pure functions only; I/O lives in src/lib/roster-sources.ts. Shared
 * by POST /api/v1/roster/verify and the `verify_roster` MCP tool.
 *
 * Rules that are easy to get wrong, and the reason for each:
 *  - Missing data is never a clean result. A source that could not be checked
 *    says `checked: false`, and the flag list says so.
 *  - The live NPPES registry omits deactivated NPIs, so "not in NPPES" means
 *    deactivated or never issued, not "unknown".
 *  - A SAM exclusion is matched on the SAM record's NPI field, which has a
 *    documented false-positive history (CLAUDE.md, H23). It is flagged
 *    `needs_review` unless the SAM name agrees with the NPPES name.
 *  - Endpoint reach excludes vendor URLs listing more than 10 NPIs
 *    (practice-wide lists), the same rule as the connectivity ledger.
 */
import { isValidNpi } from '@/lib/suppression';
import { VENDOR_NPI_LIST_THRESHOLD, lookupOrganization, type OrgIndex } from '@/lib/org-lookup';

export const BATCH_LIMITS: Record<string, number> = {
  trial: 25,
  free: 25,
  partner: 200,
  enterprise: 500,
};
export const BASE_UNITS = 5;
export const UNITS_PER_NPI = 2;
export const MAX_ENDPOINTS_SHOWN = 5;

export function rosterUnits(n: number): number {
  return BASE_UNITS + UNITS_PER_NPI * n;
}

export type ParsedRoster =
  | { ok: true; npis: string[]; invalid: string[]; duplicates: number }
  | { ok: false; error: string };

/**
 * Accept an array of NPIs (strings or numbers). Values with ten digits and a
 * bad check digit are reported back as invalid without any lookup; anything
 * else that is not ten digits fails the whole request, because it usually
 * means the caller sent the wrong column.
 */
export function parseRoster(input: unknown, limit: number): ParsedRoster {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'npis must be a non-empty array of 10-digit NPIs.' };
  }
  const seen = new Set<string>();
  const npis: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const raw of input) {
    const v = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    if (!/^\d{10}$/.test(v)) {
      return { ok: false, error: 'Every entry must be a 10-digit NPI. Check that the right column was sent.' };
    }
    if (seen.has(v)) {
      duplicates++;
      continue;
    }
    seen.add(v);
    if (isValidNpi(v)) npis.push(v);
    else invalid.push(v);
  }
  if (npis.length + invalid.length > limit) {
    return { ok: false, error: `This key can verify up to ${limit} NPIs per call; ${npis.length + invalid.length} were sent. Split the list.` };
  }
  return { ok: true, npis, invalid, duplicates };
}

// ---------------------------------------------------------------------------
// Source rows
// ---------------------------------------------------------------------------

export interface WarehouseRow {
  npi: string;
  prac: { active: boolean | null; family: string | null; given: string | null; state: string | null } | null;
  org: { active: boolean | null; name: string | null; state: string | null } | null;
  roles: { active_roles: number | null; org_refs: string[] | null } | null;
  leie: { excldate: string | null; excltype: string | null } | null;
  sam: {
    active_date: string | null;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    agency: string | null;
  } | null;
}

export type NppesResult =
  | { checked: false }
  | { checked: true; found: false }
  | {
      checked: true;
      found: true;
      enumeration_type: 'NPI-1' | 'NPI-2' | string;
      status: string | null;
      name: string;
      last_name: string | null;
      first_name: string | null;
      primary_taxonomy: { code: string; desc: string | null } | null;
      last_updated: string | null;
    };

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface RosterEndpoint {
  org_npi: string;
  url: string;
  source: 'ndh' | 'vendor_file';
  vendor: string | null;
}

export interface RosterResult {
  npi: string;
  valid_check_digit: boolean;
  directory: {
    checked: boolean;
    found: boolean;
    kind: 'practitioner' | 'organization' | null;
    active: boolean | null;
    name: string | null;
    state: string | null;
    active_roles: number | null;
    linked_organizations: number | null;
  };
  nppes: NppesResult & { source: 'NPPES NPI Registry (live)' };
  exclusions: {
    checked: boolean;
    oig_leie: { excluded: boolean; exclusion_date: string | null; exclusion_type: string | null };
    sam: {
      excluded: boolean;
      active_date: string | null;
      agency: string | null;
      name_matches_nppes: boolean | null;
      needs_review: boolean;
    };
  };
  endpoint: {
    checked: boolean;
    reachable: boolean;
    practice_wide_only: boolean;
    organizations_checked: number;
    endpoints: RosterEndpoint[];
  };
  medicare_enrollment: { checked: false; note: string };
  flags: string[];
  verify_urls: { nppes: string; oig_leie: string; sam: string };
}

const MEDICARE_NOTE = 'Not checked in this version; see https://data.cms.gov for Medicare enrollment.';

export function verifyUrls(npi: string) {
  return {
    nppes: `https://npiregistry.cms.hhs.gov/provider-view/${npi}`,
    oig_leie: 'https://exclusions.oig.hhs.gov/',
    sam: 'https://sam.gov/search/?index=ex',
  };
}

const SUFFIXES = /\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|CO|PC|P C|PA|PLLC|LLP|LTD|MD|DO|PHD|JR|SR|II|III|THE)\b/g;

export function normName(s: string | null | undefined): string {
  return (s ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does the SAM record name the same party as NPPES? Individuals: same last
 * name and same first initial. Organizations: same normalized name. Returns
 * null when NPPES has no record to compare against.
 */
export function samNameMatches(sam: NonNullable<WarehouseRow['sam']>, nppes: NppesResult): boolean | null {
  if (!nppes.checked || !nppes.found) return null;
  if (nppes.enumeration_type === 'NPI-1') {
    const last = normName(sam.last_name);
    const first = normName(sam.first_name);
    if (!last) return false;
    return last === normName(nppes.last_name) && first.slice(0, 1) === normName(nppes.first_name).slice(0, 1);
  }
  const samName = normName(sam.name || [sam.first_name, sam.last_name].filter(Boolean).join(' '));
  return samName !== '' && samName === normName(nppes.name);
}

function orgNpiFromRef(ref: string): string | null {
  const m = /Organization\/Organization-(\d{10})$/.exec(ref);
  return m ? m[1] : null;
}

/** Endpoints for one or more organization NPIs, deterministic routes first. */
export function endpointsFor(orgNpis: string[], index: OrgIndex) {
  const out: RosterEndpoint[] = [];
  let practiceWide = 0;
  for (const npi of orgNpis) {
    const r = lookupOrganization(index, npi);
    for (const e of r.endpoints) {
      const listCount = e.vendor_file?.npis_on_url ?? null;
      const wide = e.source === 'vendor_file' && listCount !== null && listCount > VENDOR_NPI_LIST_THRESHOLD;
      if (wide) {
        practiceWide++;
        continue;
      }
      out.push({ org_npi: npi, url: e.base_url, source: e.source, vendor: e.vendor });
    }
  }
  return { endpoints: out, practiceWide };
}

export interface AssembleInput {
  npi: string;
  row: WarehouseRow | null;
  nppes: NppesResult;
  index: OrgIndex | null;
  suppressed: boolean;
}

/** One NPI's result. `row` null means the warehouse query failed. */
export function assemble({ npi, row, nppes, index, suppressed }: AssembleInput): RosterResult {
  const flags: string[] = [];
  const base: RosterResult = {
    npi,
    valid_check_digit: true,
    directory: { checked: false, found: false, kind: null, active: null, name: null, state: null, active_roles: null, linked_organizations: null },
    nppes: { checked: false, source: 'NPPES NPI Registry (live)' },
    exclusions: {
      checked: false,
      oig_leie: { excluded: false, exclusion_date: null, exclusion_type: null },
      sam: { excluded: false, active_date: null, agency: null, name_matches_nppes: null, needs_review: false },
    },
    endpoint: { checked: false, reachable: false, practice_wide_only: false, organizations_checked: 0, endpoints: [] },
    medicare_enrollment: { checked: false, note: MEDICARE_NOTE },
    flags,
    verify_urls: verifyUrls(npi),
  };

  // A removal request: answer exactly as for an NPI no source could check.
  if (suppressed) {
    flags.push('not_checked');
    return base;
  }

  base.nppes = { ...nppes, source: 'NPPES NPI Registry (live)' };
  if (!nppes.checked) flags.push('nppes_not_checked');
  else if (!nppes.found) flags.push('not_in_nppes');
  else if (nppes.status && nppes.status !== 'A') flags.push('nppes_inactive');

  if (!row) {
    flags.push('directory_not_checked', 'exclusions_not_checked');
    return base;
  }

  const prac = row.prac && row.prac.active !== null ? row.prac : null;
  const org = row.org && row.org.name !== null ? row.org : null;
  base.directory.checked = true;
  if (prac) {
    base.directory = {
      checked: true,
      found: true,
      kind: 'practitioner',
      active: prac.active,
      name: [prac.given, prac.family].filter(Boolean).join(' ') || null,
      state: prac.state,
      active_roles: row.roles?.active_roles ?? 0,
      linked_organizations: row.roles?.org_refs?.length ?? 0,
    };
  } else if (org) {
    base.directory = { checked: true, found: true, kind: 'organization', active: org.active, name: org.name, state: org.state, active_roles: null, linked_organizations: null };
  }
  if (!base.directory.found) flags.push('not_in_ndh');
  else if (base.directory.active === false) flags.push('ndh_inactive');
  if (base.directory.kind === 'practitioner' && (base.directory.active_roles ?? 0) === 0) flags.push('no_active_role');

  base.exclusions.checked = true;
  if (row.leie && row.leie.excldate) {
    base.exclusions.oig_leie = { excluded: true, exclusion_date: row.leie.excldate, exclusion_type: row.leie.excltype };
    flags.push('oig_excluded');
  }
  if (row.sam && row.sam.active_date !== null) {
    const match = samNameMatches(row.sam, nppes);
    const needsReview = match !== true;
    base.exclusions.sam = { excluded: true, active_date: row.sam.active_date, agency: row.sam.agency, name_matches_nppes: match, needs_review: needsReview };
    flags.push(needsReview ? 'sam_excluded_needs_review' : 'sam_excluded');
  }

  if (index) {
    const orgNpis =
      base.directory.kind === 'organization'
        ? [npi]
        : Array.from(new Set((row.roles?.org_refs ?? []).map(orgNpiFromRef).filter((x): x is string => x !== null)));
    const { endpoints, practiceWide } = endpointsFor(orgNpis, index);
    base.endpoint = {
      checked: true,
      reachable: endpoints.length > 0,
      practice_wide_only: endpoints.length === 0 && practiceWide > 0,
      organizations_checked: orgNpis.length,
      endpoints: endpoints.slice(0, MAX_ENDPOINTS_SHOWN),
    };
    if (base.directory.found && endpoints.length === 0) flags.push('no_endpoint');
  } else {
    flags.push('endpoint_not_checked');
  }
  return base;
}

export function invalidResult(npi: string): RosterResult {
  const r = assemble({ npi, row: null, nppes: { checked: false }, index: null, suppressed: false });
  r.valid_check_digit = false;
  r.flags.splice(0, r.flags.length, 'invalid_check_digit');
  return r;
}

export interface RosterSummary {
  submitted: number;
  verified: number;
  duplicates_removed: number;
  flagged: number;
  by_flag: Record<string, number>;
}

/** Flags that call for action, as opposed to "could not check". */
export const ACTION_FLAGS = new Set([
  'invalid_check_digit',
  'not_in_nppes',
  'nppes_inactive',
  'not_in_ndh',
  'ndh_inactive',
  'oig_excluded',
  'sam_excluded',
  'sam_excluded_needs_review',
]);

export function summarize(results: RosterResult[], duplicates: number): RosterSummary {
  const byFlag: Record<string, number> = {};
  let flagged = 0;
  for (const r of results) {
    if (r.flags.some((f) => ACTION_FLAGS.has(f))) flagged++;
    for (const f of r.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
  }
  return { submitted: results.length + duplicates, verified: results.length, duplicates_removed: duplicates, flagged, by_flag: byFlag };
}

export const DISCLAIMER =
  'Signals from public federal sources, not findings. Absence of a flag is not clearance, and a source marked ' +
  '"checked: false" was not consulted. A SAM match on the NPI field has a documented false-positive history; ' +
  'needs_review means the SAM name did not match NPPES. Verify every flag at the primary source (verify_urls) ' +
  'before acting on it.';
