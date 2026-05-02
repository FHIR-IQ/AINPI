/**
 * POST /api/provider-search
 *
 * Real-time, multi-source practitioner lookup. Queries six sources in
 * parallel:
 *
 *   - ndh    — CMS National Provider Directory (our BigQuery copy)
 *   - nppes  — NPPES NPI Registry public API (authoritative)
 *   - humana — Humana FHIR provider directory
 *   - uhc    — Optum FLEX (UHC commercial + Community Plan + OptumRx)
 *   - molina — Molina via Sapphire360 (Azure APIM gateway)
 *   - cigna  — Cigna FHIR provider directory (name search only)
 *
 * No auth — every endpoint is publicly queryable per CMS-9115-F or
 * (NPPES) is a federal public registry.
 *
 * Request bodies:
 *   { type: 'npi',  npi: '1234567890',  sourceIds?: string[] }
 *   { type: 'name', family: 'Smith', given?: 'John', sourceIds?: string[] }
 *
 * `sourceIds` defaults to every source. Pass a subset to restrict.
 *
 * Each source result is normalized to the same shape so the UI can render
 * a uniform card per source.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getBigQueryClient } from '@/lib/bigquery';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// --- Source registry -----------------------------------------------------

interface SourceMeta {
  id: string;
  name: string;
  category: 'directory' | 'authoritative' | 'payer';
  /** Display copy describing what this source covers. */
  coverage: string;
  /** Whether this source can be queried by NPI directly. */
  npiSearchable: boolean;
  /** Whether name-based search is supported. */
  nameSearchable: boolean;
}

const SOURCES: SourceMeta[] = [
  {
    id: 'ndh',
    name: 'CMS NDH (AINPI BigQuery)',
    category: 'directory',
    coverage: 'CMS National Provider Directory bulk export, 2026-04-09',
    npiSearchable: true,
    nameSearchable: true,
  },
  {
    id: 'nppes',
    name: 'NPPES NPI Registry',
    category: 'authoritative',
    coverage: 'Federal NPI registry — authoritative for NPI assignment',
    npiSearchable: true,
    nameSearchable: true,
  },
  {
    id: 'humana',
    name: 'Humana',
    category: 'payer',
    coverage: 'Commercial + Medicare Advantage',
    npiSearchable: true,
    nameSearchable: true,
  },
  {
    id: 'uhc',
    name: 'UnitedHealthcare',
    category: 'payer',
    coverage: 'UHC commercial + MA + UHC Community Plan + OptumRx (Optum FLEX)',
    npiSearchable: true,
    nameSearchable: true,
  },
  {
    id: 'molina',
    name: 'Molina Healthcare',
    category: 'payer',
    coverage: 'Multi-state Medicaid (Sapphire360 backend)',
    npiSearchable: true,
    nameSearchable: true,
  },
  {
    id: 'cigna',
    name: 'Cigna',
    category: 'payer',
    coverage: 'Commercial + Medicare/Medicaid managed care (name only)',
    npiSearchable: false,
    nameSearchable: true,
  },
];

// Payer FHIR base URLs.
const PAYER_BASES: Record<string, string> = {
  humana: 'https://fhir.humana.com/api',
  uhc: 'https://flex.optum.com/fhirpublic/R4',
  molina: 'https://api.interop.molinahealthcare.com/providerdirectory',
  cigna: 'https://fhir.cigna.com/ProviderDirectory/v1',
};

const NPI_RE = /^\d{10}$/;

// --- Normalized output types --------------------------------------------

interface NormalizedAddress {
  use?: string;
  type?: string;
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  telecom?: { system: string; value: string }[];
}

interface NormalizedPractitioner {
  /** 10-digit NPI when known. */
  npi: string | null;
  /** Source-specific FHIR resource id (or NPPES enumeration). */
  sourceId: string | null;
  name: {
    family: string | null;
    given: string | null;
    prefix: string | null;
    suffix: string | null;
    full: string;
  };
  /** "M" / "F" / "U" — sourced from FHIR `gender` or NPPES `basic.sex`. */
  gender: string | null;
  /** True/false on FHIR `active`; null if source doesn't expose it. */
  active: boolean | null;
  /** Credentials suffix (e.g. "MD, FACOG") — NPPES `basic.credential`. */
  credential: string | null;
  /** Taxonomies / specialties. */
  specialties: { code: string; display: string; system?: string; primary?: boolean; license?: string; state?: string }[];
  /** Practice + mailing addresses. */
  addresses: NormalizedAddress[];
  /** Languages spoken. */
  languages: string[];
  /** Qualifications (board certifications, licenses, etc.). */
  qualifications: { code?: string; display?: string; issuer?: string; period?: string }[];
  /** ISO 8601 timestamp when source last refreshed this record. */
  lastUpdated: string | null;
  /** Identifier systems carried (e.g. "us-npi", "us-ssn") — trust signal. */
  identifierSystems: string[];
}

interface SourceResult {
  sourceId: string;
  sourceName: string;
  category: SourceMeta['category'];
  coverage: string;
  status: 'matched' | 'not_found' | 'error' | 'skipped';
  responseMs: number;
  matchCount: number;
  practitioners: NormalizedPractitioner[];
  errorMessage?: string;
}

// --- Helpers ------------------------------------------------------------

function buildFullName(p: Partial<NormalizedPractitioner['name']>): string {
  return [p.prefix, p.given, p.family, p.suffix].filter(Boolean).join(' ');
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/fhir+json, application/json',
        'User-Agent': 'AINPI-ProviderSearch/1.0 (+https://ainpi.dev)',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function pickIdentifier(idents: any[] | undefined, system: string): string | null {
  if (!Array.isArray(idents)) return null;
  for (const id of idents) {
    const sys = (id?.system || '').toLowerCase();
    const val = id?.value;
    if (typeof val !== 'string' || !val) continue;
    if (sys.includes(system.toLowerCase())) return val;
  }
  return null;
}

// --- FHIR Practitioner → normalized -------------------------------------

function normalizeFhirPractitioner(resource: any): NormalizedPractitioner {
  const idents = Array.isArray(resource?.identifier) ? resource.identifier : [];
  const npi = pickIdentifier(idents, 'us-npi');

  const names = Array.isArray(resource?.name) ? resource.name : [];
  const officialName = names.find((n: any) => n?.use === 'official') || names[0] || {};
  const givenArr = Array.isArray(officialName?.given) ? officialName.given : [];
  const family = typeof officialName?.family === 'string' ? officialName.family : null;
  const given = givenArr.length
    ? givenArr.filter((g: unknown) => typeof g === 'string').join(' ')
    : null;
  const prefix = Array.isArray(officialName?.prefix) ? officialName.prefix.join(' ') : null;
  const suffix = Array.isArray(officialName?.suffix) ? officialName.suffix.join(' ') : null;

  // Addresses
  const addrs = Array.isArray(resource?.address) ? resource.address : [];
  const addresses: NormalizedAddress[] = addrs.map((a: any) => ({
    use: typeof a?.use === 'string' ? a.use : undefined,
    type: typeof a?.type === 'string' ? a.type : undefined,
    line: Array.isArray(a?.line) ? a.line.filter((s: unknown) => typeof s === 'string') : undefined,
    city: typeof a?.city === 'string' ? a.city : undefined,
    state: typeof a?.state === 'string' ? a.state : undefined,
    postalCode: typeof a?.postalCode === 'string' ? a.postalCode : undefined,
    country: typeof a?.country === 'string' ? a.country : undefined,
  }));

  // Telecom — promote to address-level when applicable
  const telecom = Array.isArray(resource?.telecom) ? resource.telecom : [];
  if (telecom.length && addresses.length) {
    addresses[0].telecom = telecom
      .map((t: any) => ({
        system: typeof t?.system === 'string' ? t.system : 'unknown',
        value: typeof t?.value === 'string' ? t.value : '',
      }))
      .filter((t: any) => t.value);
  }

  // Qualifications
  const quals = Array.isArray(resource?.qualification) ? resource.qualification : [];
  const qualifications = quals.map((q: any) => {
    const codeText = q?.code?.text;
    const codeCoding = Array.isArray(q?.code?.coding) ? q.code.coding[0] : null;
    return {
      code: codeCoding?.code,
      display: codeText || codeCoding?.display,
      issuer: q?.issuer?.display || q?.issuer?.reference,
      period: q?.period?.start
        ? `${q.period.start}${q.period.end ? ` → ${q.period.end}` : ''}`
        : undefined,
    };
  });

  // Languages
  const comm = Array.isArray(resource?.communication) ? resource.communication : [];
  const languages = comm
    .map((c: any) => c?.coding?.[0]?.display || c?.text || c?.coding?.[0]?.code)
    .filter((s: unknown): s is string => typeof s === 'string');

  // FHIR Practitioner doesn't carry specialties directly — those live in
  // PractitionerRole. We surface specialty info inferred from qualifications.

  return {
    npi,
    sourceId: typeof resource?.id === 'string' ? resource.id : null,
    name: { family, given, prefix, suffix, full: buildFullName({ family, given, prefix, suffix }) },
    gender: typeof resource?.gender === 'string' ? resource.gender : null,
    active: typeof resource?.active === 'boolean' ? resource.active : null,
    credential: null,
    specialties: [],
    addresses,
    languages,
    qualifications,
    lastUpdated: typeof resource?.meta?.lastUpdated === 'string' ? resource.meta.lastUpdated : null,
    identifierSystems: idents
      .map((i: any) => (typeof i?.system === 'string' ? i.system : ''))
      .filter(Boolean),
  };
}

// --- NPPES → normalized -------------------------------------------------

function normalizeNppesResult(r: any): NormalizedPractitioner {
  const basic = r?.basic ?? {};
  const family = basic?.last_name ?? basic?.organization_name ?? null;
  const given = [basic?.first_name, basic?.middle_name].filter(Boolean).join(' ') || null;
  const prefix = basic?.name_prefix || null;
  const suffix = basic?.name_suffix || null;

  const addrsRaw: any[] = Array.isArray(r?.addresses) ? r.addresses : [];
  const addresses: NormalizedAddress[] = addrsRaw.map((a: any) => ({
    use: a?.address_purpose === 'MAILING' ? 'mailing' : 'work',
    type: a?.address_type,
    line: [a?.address_1, a?.address_2].filter(Boolean),
    city: a?.city,
    state: a?.state,
    postalCode: a?.postal_code,
    country: a?.country_code,
    telecom: [
      a?.telephone_number ? { system: 'phone', value: a.telephone_number } : null,
      a?.fax_number ? { system: 'fax', value: a.fax_number } : null,
    ].filter(Boolean) as { system: string; value: string }[],
  }));

  const taxonomies: any[] = Array.isArray(r?.taxonomies) ? r.taxonomies : [];
  const specialties = taxonomies.map((t: any) => ({
    code: t?.code ?? '',
    display: t?.desc ?? '',
    system: 'http://nucc.org/provider-taxonomy',
    primary: !!t?.primary,
    license: t?.license,
    state: t?.state,
  }));

  return {
    npi: r?.number ?? null,
    sourceId: r?.number ?? null,
    name: { family, given, prefix, suffix, full: buildFullName({ family, given, prefix, suffix }) },
    gender: basic?.sex ?? basic?.gender ?? null,
    active: basic?.status === 'A' ? true : basic?.status === 'D' ? false : null,
    credential: basic?.credential ?? null,
    specialties,
    addresses,
    languages: [],
    qualifications: [],
    lastUpdated: basic?.last_updated ?? null,
    identifierSystems: ['http://hl7.org/fhir/sid/us-npi'],
  };
}

// --- Source query implementations ---------------------------------------

async function queryNppes(
  query: NormalizedQuery,
): Promise<{ practitioners: NormalizedPractitioner[]; status: SourceResult['status']; errorMessage?: string }> {
  const params = new URLSearchParams({ version: '2.1' });
  if (query.type === 'npi') {
    params.set('number', query.npi!);
  } else {
    if (query.family) params.set('last_name', query.family);
    if (query.given) params.set('first_name', query.given);
    params.set('limit', '20');
  }
  const url = `https://npiregistry.cms.hhs.gov/api/?${params.toString()}`;
  const res = await fetchWithTimeout(url, 8000);
  if (!res.ok) {
    return { practitioners: [], status: 'error', errorMessage: `HTTP ${res.status}` };
  }
  const body = await res.json();
  const results: any[] = Array.isArray(body?.results) ? body.results : [];
  const practitioners = results.slice(0, 5).map(normalizeNppesResult);
  return {
    practitioners,
    status: practitioners.length > 0 ? 'matched' : 'not_found',
  };
}

async function queryNdh(
  query: NormalizedQuery,
): Promise<{ practitioners: NormalizedPractitioner[]; status: SourceResult['status']; errorMessage?: string }> {
  try {
    const client = getBigQueryClient();
    let sql: string;
    let params: Record<string, unknown>;
    if (query.type === 'npi') {
      sql = `
        SELECT resource
        FROM \`thematic-fort-453901-t7.cms_npd.practitioner\`
        WHERE _npi = @npi
        LIMIT 5
      `;
      params = { npi: query.npi };
    } else {
      const conditions: string[] = [];
      params = {};
      if (query.family) {
        conditions.push('UPPER(_family_name) = UPPER(@family)');
        params.family = query.family;
      }
      if (query.given) {
        conditions.push('UPPER(_given_name) LIKE UPPER(@givenLike)');
        params.givenLike = `%${query.given}%`;
      }
      sql = `
        SELECT resource
        FROM \`thematic-fort-453901-t7.cms_npd.practitioner\`
        WHERE ${conditions.join(' AND ')}
        LIMIT 5
      `;
    }
    const [rows] = await client.query({ query: sql, params });
    const practitioners = rows
      .map((r: any) => {
        try {
          const obj = typeof r.resource === 'string' ? JSON.parse(r.resource) : r.resource;
          return normalizeFhirPractitioner(obj);
        } catch {
          return null;
        }
      })
      .filter((p): p is NormalizedPractitioner => p !== null);
    return {
      practitioners,
      status: practitioners.length > 0 ? 'matched' : 'not_found',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { practitioners: [], status: 'error', errorMessage: msg.slice(0, 200) };
  }
}

async function queryPayer(
  payerId: string,
  query: NormalizedQuery,
): Promise<{ practitioners: NormalizedPractitioner[]; status: SourceResult['status']; errorMessage?: string }> {
  const base = PAYER_BASES[payerId];
  if (!base) {
    return { practitioners: [], status: 'error', errorMessage: 'unknown payer' };
  }

  let url: string;
  if (query.type === 'npi') {
    if (payerId === 'cigna') {
      return {
        practitioners: [],
        status: 'skipped',
        errorMessage: 'Cigna does not support NPI search — switch to name search',
      };
    }
    const npiIdentifier = `http://hl7.org/fhir/sid/us-npi|${query.npi}`;
    url = `${base}/Practitioner?identifier=${encodeURIComponent(npiIdentifier)}`;
  } else {
    const params = new URLSearchParams();
    if (query.family) params.set('family', query.family);
    if (query.given) params.set('given', query.given);
    params.set('_count', '10');
    url = `${base}/Practitioner?${params.toString()}`;
  }

  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) {
    if (res.status === 404) return { practitioners: [], status: 'not_found' };
    return { practitioners: [], status: 'error', errorMessage: `HTTP ${res.status}` };
  }
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return { practitioners: [], status: 'error', errorMessage: 'malformed JSON' };
  }
  if (body?.resourceType !== 'Bundle') {
    return { practitioners: [], status: 'error', errorMessage: `unexpected resourceType: ${body?.resourceType ?? 'none'}` };
  }
  const entries: any[] = Array.isArray(body.entry) ? body.entry : [];
  let practitioners = entries
    .map((e: any) => e?.resource)
    .filter((r: any) => r?.resourceType === 'Practitioner')
    .map(normalizeFhirPractitioner);

  // For Cigna name-search: post-filter by NPI when the user gave one.
  if (query.type === 'name' && query.requireNpi) {
    practitioners = practitioners.filter((p) => p.npi === query.requireNpi);
  }

  return {
    practitioners: practitioners.slice(0, 5),
    status: practitioners.length > 0 ? 'matched' : 'not_found',
  };
}

async function querySource(meta: SourceMeta, query: NormalizedQuery): Promise<SourceResult> {
  const start = Date.now();
  let result: { practitioners: NormalizedPractitioner[]; status: SourceResult['status']; errorMessage?: string };
  try {
    if (meta.id === 'nppes') result = await queryNppes(query);
    else if (meta.id === 'ndh') result = await queryNdh(query);
    else result = await queryPayer(meta.id, query);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    result = { practitioners: [], status: 'error', errorMessage: /aborted/i.test(msg) ? 'timed out' : msg.slice(0, 200) };
  }
  return {
    sourceId: meta.id,
    sourceName: meta.name,
    category: meta.category,
    coverage: meta.coverage,
    responseMs: Date.now() - start,
    matchCount: result.practitioners.length,
    ...result,
  };
}

// --- Request handlers ---------------------------------------------------

interface NormalizedQuery {
  type: 'npi' | 'name';
  npi?: string;
  family?: string;
  given?: string;
  requireNpi?: string;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const type = body?.type === 'name' ? 'name' : 'npi';
  let query: NormalizedQuery;

  if (type === 'npi') {
    const npi = String(body?.npi ?? '').trim();
    if (!NPI_RE.test(npi)) {
      return NextResponse.json({ error: 'NPI must be exactly 10 digits' }, { status: 400 });
    }
    query = { type: 'npi', npi };
  } else {
    const family = String(body?.family ?? '').trim().slice(0, 100);
    const given = String(body?.given ?? '').trim().slice(0, 100);
    if (!family && !given) {
      return NextResponse.json({ error: 'name search requires family and/or given' }, { status: 400 });
    }
    query = {
      type: 'name',
      family: family || undefined,
      given: given || undefined,
      requireNpi: typeof body?.requireNpi === 'string' && NPI_RE.test(body.requireNpi) ? body.requireNpi : undefined,
    };
  }

  // Resolve which sources to query. Back-compat: also accept `payerIds`.
  const requestedIds: string[] = Array.isArray(body?.sourceIds)
    ? body.sourceIds.filter((s: unknown) => typeof s === 'string')
    : Array.isArray(body?.payerIds)
    ? body.payerIds.filter((s: unknown) => typeof s === 'string')
    : [];
  const targets = requestedIds.length > 0 ? SOURCES.filter((s) => requestedIds.includes(s.id)) : SOURCES;

  if (targets.length === 0) {
    return NextResponse.json(
      { error: 'no valid sourceIds; valid ids: ' + SOURCES.map((s) => s.id).join(', ') },
      { status: 400 },
    );
  }

  const startedAt = new Date();
  const results = await Promise.all(targets.map((s) => querySource(s, query)));

  const matched = results.filter((r) => r.status === 'matched').length;
  const notFound = results.filter((r) => r.status === 'not_found').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const totalMs = results.reduce((s, r) => s + r.responseMs, 0);

  return NextResponse.json({
    ok: true,
    query,
    queriedAt: startedAt.toISOString(),
    summary: {
      sourcesQueried: results.length,
      matched,
      notFound,
      errors,
      skipped,
      totalMs,
      avgMs: Math.round(totalMs / results.length),
    },
    results,
  });
}

export async function GET() {
  return NextResponse.json({ sources: SOURCES });
}
