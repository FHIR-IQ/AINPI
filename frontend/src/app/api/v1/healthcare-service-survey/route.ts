/**
 * POST /api/v1/healthcare-service-survey
 *
 * Captures a community survey response about payer / integrator current
 * state for FHIR HealthcareService publishing + recommendations for what
 * AINPI should standardize. Persists to Supabase (HealthcareServiceSurvey
 * Response model) and fires a realtime admin alert via lib/admin-email.
 *
 * Tolerant input shape — every field optional except a basic sanity check.
 * Anonymous responses allowed; email only required if `wantsFollowUp` is
 * true so we can actually follow up.
 *
 * GET returns the aggregate result payload consumed by the public results
 * page. Counts only; no individual responses leak.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendSurveyAlert } from '@/lib/admin-email';
import {
  HCS_CATEGORIES,
  HCS_FHIR_PROFILES,
  HCS_MUST_SUPPORT_FIELDS,
  HCS_ROLE_TYPES,
} from '@/data/healthcare-service-survey';

export const dynamic = 'force-dynamic';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TEXT = 4000;

function cleanText(v: unknown, max: number = MAX_TEXT): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function cleanCodeArray(v: unknown, allow: Set<string>): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const code = raw.trim();
    if (!allow.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

const CATEGORY_CODES = new Set(HCS_CATEGORIES.map((c) => c.code));
const MUST_SUPPORT_CODES = new Set(HCS_MUST_SUPPORT_FIELDS.map((c) => c.code));
const FHIR_PROFILE_CODES = new Set(HCS_FHIR_PROFILES.map((c) => c.code));
const ROLE_CODES = new Set(HCS_ROLE_TYPES.map((c) => c.code));

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const email = cleanText(body.email, 200);
  if (email && !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid email format' }, { status: 400 });
  }

  const wantsFollowUp = !!body.wantsFollowUp;
  if (wantsFollowUp && !email) {
    return NextResponse.json(
      { error: 'email required when wantsFollowUp is true' },
      { status: 400 },
    );
  }

  const name = cleanText(body.name, 200);
  const organization = cleanText(body.organization, 200);
  const roleRaw = cleanText(body.roleType, 80);
  const roleType = roleRaw && ROLE_CODES.has(roleRaw) ? roleRaw : null;

  const categoriesUsed = cleanCodeArray(body.categoriesUsed, CATEGORY_CODES);
  const categoriesPain = cleanCodeArray(body.categoriesPain, CATEGORY_CODES);
  const mustSupportFields = cleanCodeArray(body.mustSupportFields, MUST_SUPPORT_CODES);
  const consumerOf = Array.isArray(body.consumerOf)
    ? (body.consumerOf as unknown[])
        .filter((v): v is string => typeof v === 'string')
        .map((s) => s.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 30)
    : [];

  const profileRaw = cleanText(body.fhirProfile, 60);
  const fhirProfile =
    profileRaw && FHIR_PROFILE_CODES.has(profileRaw) ? profileRaw : null;
  const identifierSystem = cleanText(body.identifierSystem, 300);
  const publishCadence = cleanText(body.publishCadence, 40);

  const painPoints = cleanText(body.painPoints, MAX_TEXT);
  const recommendations = cleanText(body.recommendations, MAX_TEXT);

  // At least one substantive field has to be present so we don't fill the
  // table with empty rows from accidental form submits.
  if (
    !email &&
    !organization &&
    categoriesUsed.length === 0 &&
    !painPoints &&
    !recommendations
  ) {
    return NextResponse.json(
      { error: 'please answer at least one substantive question' },
      { status: 400 },
    );
  }

  try {
    await prisma.healthcareServiceSurveyResponse.create({
      data: {
        email,
        name,
        organization,
        roleType,
        categoriesUsed,
        categoriesPain,
        mustSupportFields,
        consumerOf,
        fhirProfile,
        identifierSystem,
        publishCadence,
        painPoints,
        recommendations,
        wantsFollowUp,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: req.headers.get('user-agent')?.slice(0, 500) || null,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[hcs-survey] persist failed:', msg);
    return NextResponse.json(
      { error: 'survey service unavailable' },
      { status: 503 },
    );
  }

  // Fire admin alert without blocking the response.
  void prisma.healthcareServiceSurveyResponse
    .count()
    .catch(() => undefined)
    .then((totalAfter) =>
      sendSurveyAlert({
        survey: 'healthcare-service',
        email,
        name,
        organization,
        roleType,
        categoriesUsed,
        fhirProfile,
        painPoints,
        recommendations,
        wantsFollowUp,
        totalAfter: typeof totalAfter === 'number' ? totalAfter : undefined,
      }),
    );

  return NextResponse.json({ ok: true });
}

/**
 * GET — public aggregate. Counts only, no PII. Drives the results page.
 */
export async function GET() {
  try {
    const responses = await prisma.healthcareServiceSurveyResponse.findMany({
      select: {
        categoriesUsed: true,
        categoriesPain: true,
        mustSupportFields: true,
        fhirProfile: true,
        roleType: true,
        publishCadence: true,
        wantsFollowUp: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const tally = <T extends string>(rows: T[][]) => {
      const counts = new Map<T, number>();
      for (const row of rows) {
        const seen = new Set<T>();
        for (const v of row) {
          if (seen.has(v)) continue;
          seen.add(v);
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      return [...counts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count);
    };

    const scalarTally = (rows: (string | null)[]) => {
      const counts = new Map<string, number>();
      for (const v of rows) {
        if (!v) continue;
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count);
    };

    const categoriesUsed = tally(
      responses.map((r) => (Array.isArray(r.categoriesUsed) ? (r.categoriesUsed as string[]) : [])),
    );
    const categoriesPain = tally(
      responses.map((r) => (Array.isArray(r.categoriesPain) ? (r.categoriesPain as string[]) : [])),
    );
    const mustSupportPopulated = tally(
      responses.map((r) =>
        Array.isArray(r.mustSupportFields) ? (r.mustSupportFields as string[]) : [],
      ),
    );
    const fhirProfile = scalarTally(responses.map((r) => r.fhirProfile));
    const roleType = scalarTally(responses.map((r) => r.roleType));
    const publishCadence = scalarTally(responses.map((r) => r.publishCadence));
    const wantsFollowUp = responses.filter((r) => r.wantsFollowUp).length;

    return NextResponse.json({
      total_responses: responses.length,
      generated_at: new Date().toISOString(),
      counts: {
        categoriesUsed,
        categoriesPain,
        mustSupportPopulated,
        fhirProfile,
        roleType,
        publishCadence,
        wantsFollowUp,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[hcs-survey:aggregate] failed:', msg);
    return NextResponse.json(
      { error: 'survey aggregate unavailable' },
      { status: 503 },
    );
  }
}
