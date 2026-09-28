/**
 * Organization NPI -> FHIR endpoints, from two already-published files.
 *
 * Backs the MCP `lookup_organization` tool. Pure parsing, indexing and
 * normalization live here so they can be tested without a network; the only
 * I/O is the injectable `fetchText` in `createOrgIndexLoader`.
 *
 * Sources, both under /api/v1/findings/:
 *
 *   endpoint-org-crosswalk.csv (H50)       The NDH Endpoint's own
 *     managingOrganization, resolved to an organization NPI. This is the CMS
 *     record. Columns: endpoint_id,base_url,host,status,org_id,org_npi,
 *     org_name,org_state.
 *   vendor-endpoint-attribution.csv (H51)  The endpoint lists EHR vendors
 *     publish themselves. A vendor naming an organization for a URL is the
 *     vendor's claim, not CMS data, and every row served from it says so.
 *     Columns: url,org_name,org_npi,vendor,in_ndh,ndh_has_owner.
 *
 * Why HTTPS and not fs: next.config.js excludes public/api/v1/findings/** from
 * every lambda bundle (the 250 MB limit), so the files do not exist on disk at
 * runtime. They are fetched from the site's own CDN.
 *
 * Silent-zero rule: a failed fetch, an empty file or a missing column throws
 * OrgLookupSourceError. It never produces an empty index, because an empty
 * index answers every NPI with a plausible "not found".
 */
import { CURRENT_RELEASE } from '@/lib/release';

export const CROSSWALK_PATH = '/api/v1/findings/endpoint-org-crosswalk.csv';
export const VENDOR_PATH = '/api/v1/findings/vendor-endpoint-attribution.csv';
export const LINKAGE_PATH = '/api/v1/findings/endpoint-org-linkage.json';

export const VENDOR_CLAIM_LABEL =
  "The EHR vendor's own published claim that this organization uses this endpoint, " +
  'from its public endpoint list (AINPI H51). Not CMS data.';

export class OrgLookupSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgLookupSourceError';
  }
}

// ---------------------------------------------------------------------------
// URL normalization
// ---------------------------------------------------------------------------

/**
 * Join-key form of an endpoint URL. Mirrors `normalize_url` in
 * analysis/org_endpoint_table.py, which uses Python's `urlsplit`: scheme and
 * host lower-cased, trailing slashes stripped from the path, path/query/
 * fragment otherwise as published (some vendors put case-sensitive tenant
 * ids in the path). A regex split rather than `new URL()`, because the WHATWG
 * parser adds a slash to an empty path, drops default ports and
 * percent-encodes, none of which urlsplit does.
 */
export function normalizeUrl(url: string | null | undefined): string | null {
  if (url == null) return null;
  const s = url.trim();
  if (!s) return null;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(s);
  if (!m) {
    // urlsplit treats a scheme-less string as all path; only the trailing
    // slashes change.
    return s.replace(/\/+$/, '');
  }
  const [, scheme, netloc, path, query = '', fragment = ''] = m;
  return (
    `${scheme.toLowerCase()}://${netloc.toLowerCase()}${path.replace(/\/+$/, '')}` +
    `${query === '?' ? '' : query}${fragment === '#' ? '' : fragment}`
  );
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * RFC 4180 parse: quoted fields, doubled-quote escapes, CRLF or LF.
 *
 * Fields are cut with `slice` rather than built a character at a time.
 * Character-by-character `+=` leaves V8 rope strings behind, which on the
 * 8 MB vendor file retained roughly 100 MB of heap and took over 500 ms.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    let field: string;
    if (text.charCodeAt(i) === 34 /* " */) {
      let j = i + 1;
      let hasEscape = false;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          j = n;
          break;
        }
        if (text.charCodeAt(q + 1) === 34) {
          hasEscape = true;
          j = q + 2;
          continue;
        }
        j = q;
        break;
      }
      field = text.slice(i + 1, j);
      if (hasEscape) field = field.replace(/""/g, '"');
      i = j + 1; // past the closing quote
    } else {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13) break;
        j++;
      }
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    const c = text.charCodeAt(i);
    if (c === 44 /* , */) {
      i++;
      if (i === n) row.push('');
    } else {
      // newline or end of input
      if (c === 13 && text.charCodeAt(i + 1) === 10) i += 2;
      else if (i < n) i++;
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) rows.push(row);
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0];
  return nonEmpty.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((k, i) => {
      rec[k] = r[i] ?? '';
    });
    return rec;
  });
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

interface NdhRow {
  endpoint_id: string;
  base_url: string;
  status: string;
  org_name: string;
  org_state: string;
}

interface VendorRow {
  url: string;
  org_name: string;
  vendor: string;
  in_ndh: string;
  ndh_has_owner: string;
}

export interface H50Figure {
  numerator: number;
  denominator: number;
  release_date: string | null;
}

export interface OrgIndex {
  ndhByNpi: Map<string, NdhRow[]>;
  vendorByNpi: Map<string, VendorRow[]>;
  /** Vendor name for every URL any vendor file lists, NPI or not. */
  vendorByUrl: Map<string, string>;
  h50: H50Figure | null;
  rows: { crosswalk: number; vendor: number; vendor_with_npi: number };
}

const CROSSWALK_COLS = ['endpoint_id', 'base_url', 'status', 'org_npi', 'org_name', 'org_state'];
const VENDOR_COLS = ['url', 'org_name', 'org_npi', 'vendor', 'in_ndh', 'ndh_has_owner'];
const NPI_RE = /^\d{10}$/;

function requireRows(
  name: string,
  csv: string,
  cols: string[],
): Record<string, string>[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) throw new OrgLookupSourceError(`${name} has no rows`);
  const missing = cols.filter((c) => !(c in rows[0]));
  if (missing.length) {
    throw new OrgLookupSourceError(`${name} is missing columns: ${missing.join(', ')}`);
  }
  return rows;
}

function parseH50(json: string | null): H50Figure | null {
  if (!json) return null;
  try {
    const d = JSON.parse(json) as Record<string, unknown>;
    const numerator = Number(d.numerator);
    const denominator = Number(d.denominator);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
      return null;
    }
    return {
      numerator,
      denominator,
      release_date: typeof d.release_date === 'string' ? d.release_date : null,
    };
  } catch {
    return null;
  }
}

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

export function buildOrgIndex(input: {
  crosswalkCsv: string;
  vendorCsv: string;
  linkageJson: string | null;
}): OrgIndex {
  const cw = requireRows('endpoint-org-crosswalk.csv', input.crosswalkCsv, CROSSWALK_COLS);
  const vf = requireRows('vendor-endpoint-attribution.csv', input.vendorCsv, VENDOR_COLS);

  const ndhByNpi = new Map<string, NdhRow[]>();
  for (const r of cw) {
    if (!NPI_RE.test(r.org_npi)) continue;
    push(ndhByNpi, r.org_npi, {
      endpoint_id: r.endpoint_id,
      base_url: r.base_url,
      status: r.status,
      org_name: r.org_name,
      org_state: r.org_state,
    });
  }

  const vendorByNpi = new Map<string, VendorRow[]>();
  const vendorByUrl = new Map<string, string>();
  let withNpi = 0;
  for (const r of vf) {
    const key = normalizeUrl(r.url);
    if (key && r.vendor && !vendorByUrl.has(key)) vendorByUrl.set(key, r.vendor);
    if (!NPI_RE.test(r.org_npi)) continue;
    withNpi++;
    push(vendorByNpi, r.org_npi, {
      url: r.url,
      org_name: r.org_name,
      vendor: r.vendor,
      in_ndh: r.in_ndh,
      ndh_has_owner: r.ndh_has_owner,
    });
  }

  return {
    ndhByNpi,
    vendorByNpi,
    vendorByUrl,
    h50: parseH50(input.linkageJson),
    rows: { crosswalk: cw.length, vendor: vf.length, vendor_with_npi: withNpi },
  };
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export type EndpointSource = 'ndh' | 'vendor_file';

export interface OrgEndpoint {
  /** As published by the primary source (the NDH when both name it). */
  base_url: string;
  /** EHR vendor, from the vendor files; null when no vendor file lists the URL. */
  vendor: string | null;
  /** Primary attribution. "ndh" wins when both sources name this NPI. */
  source: EndpointSource;
  /** Every source that attributes this endpoint to this NPI. */
  sources: EndpointSource[];
  ndh: { endpoint_id: string; status: string } | null;
  vendor_file: {
    label: string;
    vendor: string;
    url: string;
    in_ndh: boolean | null;
    ndh_has_owner: boolean | null;
  } | null;
}

export interface OrgLookupResult {
  npi: string;
  found: boolean;
  names: { name: string; source: EndpointSource }[];
  state: string | null;
  endpoints: OrgEndpoint[];
  release_date: string;
  notes: string;
}

function yesNo(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (s === 'yes') return true;
  if (s === 'no') return false;
  return null;
}

function h50Sentence(h50: H50Figure | null): string {
  if (!h50) {
    return (
      'The NDH names a managing organization for only a minority of its FHIR REST ' +
      'endpoints (AINPI H50; the measured figure could not be read just now, see ' +
      '/findings/endpoint-org-linkage).'
    );
  }
  const pct = ((100 * h50.numerator) / h50.denominator).toFixed(1);
  return (
    `The NDH names a managing organization for only ${h50.numerator.toLocaleString('en-US')} ` +
    `of ${h50.denominator.toLocaleString('en-US')} FHIR REST endpoints (${pct}%, AINPI H50` +
    `${h50.release_date ? `, release ${h50.release_date}` : ''}), so absence here is weak ` +
    'evidence that the organization has no endpoint.'
  );
}

export function lookupOrganization(
  index: OrgIndex,
  npi: string,
  opts: { stale?: boolean } = {},
): OrgLookupResult {
  const ndh = index.ndhByNpi.get(npi) ?? [];
  const ven = index.vendorByNpi.get(npi) ?? [];

  const byKey = new Map<string, OrgEndpoint>();
  const order: string[] = [];

  for (const r of ndh) {
    const key = normalizeUrl(r.base_url);
    if (!key || byKey.has(key)) continue;
    order.push(key);
    byKey.set(key, {
      base_url: r.base_url,
      vendor: index.vendorByUrl.get(key) ?? null,
      source: 'ndh',
      sources: ['ndh'],
      ndh: { endpoint_id: r.endpoint_id, status: r.status },
      vendor_file: null,
    });
  }
  for (const r of ven) {
    const key = normalizeUrl(r.url);
    if (!key) continue;
    const claim = {
      label: VENDOR_CLAIM_LABEL,
      vendor: r.vendor,
      url: r.url,
      in_ndh: yesNo(r.in_ndh),
      ndh_has_owner: yesNo(r.ndh_has_owner),
    };
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.vendor_file) {
        existing.vendor_file = claim;
        existing.sources.push('vendor_file');
        existing.vendor = existing.vendor ?? (r.vendor || null);
      }
      continue;
    }
    order.push(key);
    byKey.set(key, {
      base_url: r.url,
      vendor: r.vendor || null,
      source: 'vendor_file',
      sources: ['vendor_file'],
      ndh: null,
      vendor_file: claim,
    });
  }

  const names: { name: string; source: EndpointSource }[] = [];
  const seen = new Set<string>();
  const addName = (name: string, source: EndpointSource) => {
    const n = name.trim();
    if (!n || seen.has(`${source}|${n}`)) return;
    seen.add(`${source}|${n}`);
    names.push({ name: n, source });
  };
  ndh.forEach((r) => addName(r.org_name, 'ndh'));
  ven.forEach((r) => addName(r.org_name, 'vendor_file'));

  const state = ndh.map((r) => r.org_state.trim()).find((s) => s.length > 0) ?? null;
  const endpoints = order.map((k) => byKey.get(k)!);
  const found = endpoints.length > 0;

  const parts: string[] = [];
  if (found) {
    parts.push(
      'source "ndh" is the NDH Endpoint resource\'s own managingOrganization (CMS data, ' +
        'AINPI H50 crosswalk). source "vendor_file" is the EHR vendor\'s own published ' +
        'claim (AINPI H51), not CMS data; verify it with the organization before relying ' +
        'on it. URLs are de-duplicated after lower-casing scheme and host and stripping ' +
        'trailing slashes. State comes from the NDH only; the vendor files carry none.',
    );
    if (!ndh.length) parts.push(h50Sentence(index.h50));
  } else {
    parts.push(
      `NPI ${npi} was not found in either source: no NDH Endpoint names it as ` +
        'managingOrganization, and no EHR vendor endpoint file lists it.',
    );
    parts.push(h50Sentence(index.h50));
    parts.push(
      'This tool covers organization NPIs only; use lookup_npi for the directory record.',
    );
  }
  if (opts.stale) {
    parts.push(
      'Served from a stale in-memory copy: the latest refresh of the source files failed.',
    );
  }

  return {
    npi,
    found,
    names,
    state,
    endpoints,
    release_date: CURRENT_RELEASE,
    notes: parts.join(' '),
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface LoadedIndex {
  index: OrgIndex;
  stale: boolean;
  loadedAt: number;
}

/**
 * Module-scope cache with a TTL and a shared in-flight promise, so a cold
 * burst of calls triggers one download rather than one per call.
 *
 * On refresh failure with a previous index in hand, the old index is served
 * and marked stale. With no index at all, the error propagates: the caller
 * must report a tool error, never "not found".
 */
export function createOrgIndexLoader(opts: {
  base: string;
  fetchText: (url: string) => Promise<string>;
  now?: () => number;
  ttlMs?: number;
}): () => Promise<LoadedIndex> {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? 6 * 60 * 60 * 1000;
  let cached: LoadedIndex | null = null;
  let inflight: Promise<LoadedIndex> | null = null;

  async function refresh(): Promise<LoadedIndex> {
    const get = async (path: string) => {
      try {
        return await opts.fetchText(`${opts.base}${path}`);
      } catch (e) {
        throw new OrgLookupSourceError(
          `could not fetch ${path}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    };
    const [crosswalkCsv, vendorCsv, linkageJson] = await Promise.all([
      get(CROSSWALK_PATH),
      get(VENDOR_PATH),
      // Only the not-found sentence depends on this; degrade it, not the lookup.
      opts.fetchText(`${opts.base}${LINKAGE_PATH}`).catch(() => null),
    ]);
    const index = buildOrgIndex({ crosswalkCsv, vendorCsv, linkageJson });
    return { index, stale: false, loadedAt: now() };
  }

  return async function load(): Promise<LoadedIndex> {
    if (cached && !cached.stale && now() - cached.loadedAt < ttl) return cached;
    if (!inflight) {
      inflight = refresh()
        .then((fresh) => {
          cached = fresh;
          return fresh;
        })
        .catch((err) => {
          if (cached) {
            // Keep serving what we had. loadedAt is left alone so the next
            // call past the TTL tries again.
            return { ...cached, stale: true };
          }
          throw err instanceof OrgLookupSourceError
            ? err
            : new OrgLookupSourceError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}
