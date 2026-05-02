/**
 * POST /api/provider-search
 *
 * Real-time search across publicly-queryable payer FHIR provider directories.
 * No auth required — these endpoints are CMS-9115-F-mandated public surfaces.
 *
 * Request body shapes:
 *   { type: 'npi',  npi: '1234567890',  payerIds?: string[] }
 *   { type: 'name', family: 'Smith', given?: 'John', payerIds?: string[] }
 *
 * `payerIds` defaults to every wired payer. Pass a subset to restrict.
 *
 * Each payer is queried in parallel with a 10s timeout. Cigna doesn't
 * support `?identifier=` so the route name-searches Cigna and post-filters
 * by NPI; this mirrors the H26 mco-exposure-va pattern.
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface PayerEndpoint {
  id: string;
  name: string;
  /** Display copy describing what this endpoint covers. */
  coverage: string;
  /** Base URL of the FHIR server. No trailing slash. */
  base: string;
  /** Whether this payer accepts ?identifier=NPI search natively. */
  supportsIdentifierSearch: boolean;
}

const PAYERS: PayerEndpoint[] = [
  {
    id: 'humana',
    name: 'Humana',
    coverage: 'Commercial + Medicare Advantage',
    base: 'https://fhir.humana.com/api',
    supportsIdentifierSearch: true,
  },
  {
    id: 'uhc',
    name: 'UnitedHealthcare',
    coverage: 'UHC commercial + Medicare Advantage + UHC Community Plan + OptumRx',
    base: 'https://flex.optum.com/fhirpublic/R4',
    supportsIdentifierSearch: true,
  },
  {
    id: 'molina',
    name: 'Molina Healthcare',
    coverage: 'Multi-state Medicaid (Sapphire360 backend)',
    base: 'https://api.interop.molinahealthcare.com/providerdirectory',
    supportsIdentifierSearch: true,
  },
  {
    id: 'cigna',
    name: 'Cigna',
    coverage: 'Commercial + Medicare/Medicaid managed care (no identifier search; name-only)',
    base: 'https://fhir.cigna.com/ProviderDirectory/v1',
    supportsIdentifierSearch: false,
  },
];

const NPI_RE = /^\d{10}$/;

interface SearchResult {
  payerId: string;
  payerName: string;
  coverage: string;
  status: 'matched' | 'not_found' | 'error';
  responseMs: number;
  matchCount: number;
  providers: ProviderSummary[];
  /** Set on `error` rows. */
  errorMessage?: string;
}

interface ProviderSummary {
  npi: string | null;
  family: string | null;
  given: string | null;
  prefix: string | null;
  suffix: string | null;
  gender: string | null;
  active: boolean | null;
  fhirId: string;
  /** Identifier systems carried, useful for trust signal. */
  identifierSystems: string[];
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

function summarizePractitioner(resource: any): ProviderSummary {
  const idents = Array.isArray(resource?.identifier) ? resource.identifier : [];
  const npi = pickIdentifier(idents, 'us-npi');
  const names = Array.isArray(resource?.name) ? resource.name : [];
  const officialName = names.find((n: any) => n?.use === 'official') || names[0] || {};
  const givenArr = Array.isArray(officialName?.given) ? officialName.given : [];
  return {
    npi,
    family: typeof officialName?.family === 'string' ? officialName.family : null,
    given: givenArr.length ? givenArr.filter((g: unknown) => typeof g === 'string').join(' ') : null,
    prefix: Array.isArray(officialName?.prefix) ? officialName.prefix.join(' ') : null,
    suffix: Array.isArray(officialName?.suffix) ? officialName.suffix.join(' ') : null,
    gender: typeof resource?.gender === 'string' ? resource.gender : null,
    active: typeof resource?.active === 'boolean' ? resource.active : null,
    fhirId: typeof resource?.id === 'string' ? resource.id : '',
    identifierSystems: idents
      .map((i: any) => (typeof i?.system === 'string' ? i.system : ''))
      .filter(Boolean),
  };
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

async function searchOne(
  payer: PayerEndpoint,
  query: NormalizedQuery,
): Promise<SearchResult> {
  const start = Date.now();
  try {
    let url: string;
    if (query.type === 'npi') {
      const npiIdentifier = `http://hl7.org/fhir/sid/us-npi|${query.npi}`;
      if (payer.supportsIdentifierSearch) {
        url = `${payer.base}/Practitioner?identifier=${encodeURIComponent(npiIdentifier)}`;
      } else {
        // Cigna and similar — we can't NPI-search, so this row reports
        // "use name search instead" rather than a confused empty result.
        return {
          payerId: payer.id,
          payerName: payer.name,
          coverage: payer.coverage,
          status: 'error',
          responseMs: 0,
          matchCount: 0,
          providers: [],
          errorMessage:
            "this payer does not support identifier search — switch to name search to query it",
        };
      }
    } else {
      const params = new URLSearchParams();
      if (query.family) params.set('family', query.family);
      if (query.given) params.set('given', query.given);
      params.set('_count', '20');
      url = `${payer.base}/Practitioner?${params.toString()}`;
    }

    const res = await fetchWithTimeout(url, 10000);
    const responseMs = Date.now() - start;

    if (!res.ok) {
      // 404 → empty searchset; everything else is a real error
      if (res.status === 404) {
        return {
          payerId: payer.id,
          payerName: payer.name,
          coverage: payer.coverage,
          status: 'not_found',
          responseMs,
          matchCount: 0,
          providers: [],
        };
      }
      return {
        payerId: payer.id,
        payerName: payer.name,
        coverage: payer.coverage,
        status: 'error',
        responseMs,
        matchCount: 0,
        providers: [],
        errorMessage: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`,
      };
    }

    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return {
        payerId: payer.id,
        payerName: payer.name,
        coverage: payer.coverage,
        status: 'error',
        responseMs,
        matchCount: 0,
        providers: [],
        errorMessage: 'malformed JSON response',
      };
    }

    if (body?.resourceType !== 'Bundle') {
      return {
        payerId: payer.id,
        payerName: payer.name,
        coverage: payer.coverage,
        status: 'error',
        responseMs,
        matchCount: 0,
        providers: [],
        errorMessage: `unexpected resourceType: ${body?.resourceType ?? 'missing'}`,
      };
    }

    const entries: any[] = Array.isArray(body.entry) ? body.entry : [];
    let practitioners = entries
      .map((e) => e?.resource)
      .filter((r) => r?.resourceType === 'Practitioner')
      .map(summarizePractitioner);

    // For Cigna name-search → post-filter by NPI to remove false positives
    if (query.type === 'name' && query.requireNpi) {
      practitioners = practitioners.filter((p) => p.npi === query.requireNpi);
    }

    return {
      payerId: payer.id,
      payerName: payer.name,
      coverage: payer.coverage,
      status: practitioners.length > 0 ? 'matched' : 'not_found',
      responseMs,
      matchCount: practitioners.length,
      providers: practitioners.slice(0, 5),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      payerId: payer.id,
      payerName: payer.name,
      coverage: payer.coverage,
      status: 'error',
      responseMs: Date.now() - start,
      matchCount: 0,
      providers: [],
      errorMessage: /aborted/i.test(msg) ? 'timed out after 10s' : msg,
    };
  }
}

interface NormalizedQuery {
  type: 'npi' | 'name';
  npi?: string;
  family?: string;
  given?: string;
  /** When set, post-filter name-search results by this NPI. */
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
      return NextResponse.json(
        { error: 'NPI must be exactly 10 digits' },
        { status: 400 },
      );
    }
    query = { type: 'npi', npi };
  } else {
    const family = String(body?.family ?? '').trim().slice(0, 100);
    const given = String(body?.given ?? '').trim().slice(0, 100);
    if (!family && !given) {
      return NextResponse.json(
        { error: 'name search requires family and/or given' },
        { status: 400 },
      );
    }
    query = { type: 'name', family: family || undefined, given: given || undefined };
  }

  // Resolve which payers to query.
  const requestedIds: string[] = Array.isArray(body?.payerIds)
    ? body.payerIds.filter((p: unknown) => typeof p === 'string')
    : [];
  const targets =
    requestedIds.length > 0
      ? PAYERS.filter((p) => requestedIds.includes(p.id))
      : PAYERS;

  if (targets.length === 0) {
    return NextResponse.json(
      { error: 'no valid payerIds; valid ids: ' + PAYERS.map((p) => p.id).join(', ') },
      { status: 400 },
    );
  }

  const startedAt = new Date();
  const results = await Promise.all(targets.map((p) => searchOne(p, query)));

  const matched = results.filter((r) => r.status === 'matched').length;
  const errors = results.filter((r) => r.status === 'error').length;
  const totalMs = results.reduce((s, r) => s + r.responseMs, 0);

  return NextResponse.json({
    ok: true,
    query,
    queriedAt: startedAt.toISOString(),
    summary: {
      payersQueried: results.length,
      matched,
      notFound: results.filter((r) => r.status === 'not_found').length,
      errors,
      totalMs,
      avgMs: Math.round(totalMs / results.length),
    },
    results,
  });
}

// Optional: GET returns the payer registry (so the UI can list options
// without hardcoding them).
export async function GET() {
  return NextResponse.json({
    payers: PAYERS.map(({ id, name, coverage, supportsIdentifierSearch }) => ({
      id,
      name,
      coverage,
      supportsIdentifierSearch,
    })),
  });
}
