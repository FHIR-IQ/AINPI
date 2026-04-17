/**
 * Shared helpers for NPD search queries.
 * Pure functions — unit-tested in tests/lib/npd-search-utils.test.ts.
 */

// Common credential suffixes that users type into search boxes but that don't
// appear in the FHIR `family_name` / `given_name` fields.
const CREDENTIAL_SUFFIXES = [
  'MD', 'DO', 'DDS', 'DMD', 'PhD', 'PharmD', 'DPT', 'PT', 'DC', 'OD',
  'NP', 'CRNP', 'APRN', 'ARNP', 'DNP', 'CNM', 'CRNA',
  'PA', 'PAC', 'PA-C',
  'RN', 'LPN', 'LVN', 'CNA',
  'LCSW', 'LMSW', 'LMHC', 'LMFT', 'LADC', 'LCMHC',
  'FNP', 'FNP-C', 'FNP-BC', 'ACNP', 'PNP',
  'RD', 'RDN', 'CCC-SLP', 'OTR', 'OTR/L', 'COTA',
  'DVM', 'Esq', 'Jr', 'Sr', 'II', 'III', 'IV',
];

const SUFFIX_PATTERN = new RegExp(
  '(?:^|[\\s,])(?:' + CREDENTIAL_SUFFIXES.map((s) => s.replace(/[.*+?^${}()|[\]\\\\-]/g, '\\$&')).join('|') + ')\\.?(?=$|[\\s,])',
  'gi'
);

/**
 * Strip trailing credential suffixes ("MD", "DO", "PA-C", etc.) from a name query.
 * "Smith, MD" → "Smith"; "John Smith NP" → "John Smith".
 */
export function stripCredentialSuffix(name: string): string {
  return name.replace(SUFFIX_PATTERN, '').replace(/\s*,\s*$/, '').trim().replace(/\s+/g, ' ');
}

/**
 * Split a multi-token name search into tokens suitable for AND-matching
 * against given_name + family_name.
 *
 * Input → Output
 * "Smith"          → { family: "Smith", given: null }
 * "John Smith"     → { family: "Smith", given: "John" }
 * "Smith, John"    → { family: "Smith", given: "John" }
 * "Van Der Berg"   → { family: "Van Der Berg", given: null }  (multi-word family)
 */
export function parseNameQuery(input: string): { family: string | null; given: string | null } {
  const cleaned = stripCredentialSuffix(input);
  if (!cleaned) return { family: null, given: null };

  // "Last, First" form
  const commaIdx = cleaned.indexOf(',');
  if (commaIdx >= 0) {
    const family = cleaned.slice(0, commaIdx).trim();
    const given = cleaned.slice(commaIdx + 1).trim();
    return { family: family || null, given: given || null };
  }

  // Single token → treat as either last or first (caller uses OR)
  const tokens = cleaned.split(/\s+/);
  if (tokens.length === 1) return { family: tokens[0], given: null };

  // Two+ tokens: assume "First Last" (last token = family, rest = given)
  const family = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1).join(' ');
  return { family, given };
}

/**
 * Parse a FHIR reference string ("ResourceType/ResourceType-<id>") into its ID.
 * Returns the full reference unchanged if the format doesn't match.
 */
export function refToId(reference: string | null | undefined): string | null {
  if (!reference) return null;
  const slash = reference.indexOf('/');
  if (slash < 0) return null;
  return reference.slice(slash + 1);
}

/**
 * Group a flat list of PractitionerRole rows by specialty code so the UI can
 * render "Internal Medicine (3 orgs)" instead of 3 separate rows that all say
 * "Internal Medicine" with a different org each.
 */
export interface RoleRow {
  _specialty_code: string | null;
  _specialty_display: string | null;
  _org_id: string | null;
  _active: boolean | null;
}

export interface GroupedSpecialty {
  code: string;
  display: string;
  role_count: number;
  active_count: number;
  org_ids: string[];
}

export function groupRolesBySpecialty(roles: RoleRow[]): GroupedSpecialty[] {
  const map = new Map<string, GroupedSpecialty>();

  for (const r of roles) {
    const code = r._specialty_code || '(none)';
    if (!map.has(code)) {
      map.set(code, {
        code,
        display: r._specialty_display || '(no display)',
        role_count: 0,
        active_count: 0,
        org_ids: [],
      });
    }
    const g = map.get(code)!;
    g.role_count += 1;
    if (r._active === true) g.active_count += 1;
    if (r._org_id && !g.org_ids.includes(r._org_id)) g.org_ids.push(r._org_id);
  }

  return Array.from(map.values()).sort((a, b) => b.role_count - a.role_count);
}
