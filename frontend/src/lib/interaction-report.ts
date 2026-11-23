/**
 * NPD Endpoint Feedback API, proposal v0.2 (ftrotter-gov/CMSPayerEndpointSeed,
 * docs/npd-how-did-it-go-api.md): validation, canonical form and receipt.
 *
 * Pure functions only. The routes in src/app/api/v1/interaction-reports and
 * the `report_interaction` MCP tool share them through
 * src/lib/interaction-report-store.ts, so both surfaces accept and reject
 * exactly the same bodies.
 *
 * This is AINPI's sandbox of a proposal, not an NPD API. Where the proposal is
 * silent, the choice made here is marked "sandbox choice".
 *
 * Error details never echo a submitted value (the proposal requires it, since
 * a rejected body may hold data that should not land in logs). They name the
 * field path, which the caller wrote and the schema defines.
 */
import { createHash } from 'node:crypto';

export const SCHEMA_VERSION = '1.0';
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_ISSUES = 50;
export const MAX_DESCRIPTION = 1000;
export const FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEDUPE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export const REPORTER_ROLES = ['requester', 'responder'] as const;
export const OUTCOMES = ['success', 'partial-success', 'failure', 'unknown'] as const;
export const SEVERITIES = ['error', 'warning', 'information'] as const;
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/** Stage -> allowed codes, from the proposal's issue vocabulary table. */
export const ISSUE_VOCABULARY: Record<string, readonly string[]> = {
  'directory-discovery': ['organization-not-found', 'endpoint-missing', 'directory-data-mismatch'],
  documentation: ['documentation-missing', 'documentation-unreachable', 'documentation-inaccurate'],
  connection: ['dns-failure', 'tls-failure', 'connection-refused', 'timeout'],
  authentication: ['credentials-rejected', 'token-endpoint-unreachable'],
  authorization: ['insufficient-scope', 'organization-not-authorized', 'identity-unverifiable'],
  'fhir-processing': [
    'unsupported-operation',
    'unsupported-fhir-version',
    'invalid-resource',
    'unexpected-response',
  ],
  'service-operation': ['rate-limited', 'service-unavailable'],
  other: ['other'],
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/;
// A FHIR relative reference: ResourceType/id, with FHIR's id character rules.
const FHIR_REF = /^[A-Z][A-Za-z]{1,63}\/[A-Za-z0-9\-.]{1,64}$/;
const RESOURCE_TYPE = /^[A-Z][A-Za-z]{1,63}$/;
// A property name safe to name in an error message.
const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const TOP_KEYS = new Set([
  'schemaVersion',
  'reportId',
  'reporterRole',
  'counterpartyReference',
  'counterpartyFpi',
  'endpointReference',
  'interaction',
  'outcome',
  'rating',
  'issues',
]);
const INTERACTION_KEYS = new Set([
  'startedAt',
  'endedAt',
  'fhirVersion',
  'operation',
  'resourceType',
  'httpMethod',
  'httpStatus',
]);
const ISSUE_KEYS = new Set(['stage', 'code', 'severity', 'description']);

export interface Issue {
  stage: string;
  code: string;
  severity: (typeof SEVERITIES)[number];
  description?: string;
}

export interface InteractionReport {
  schemaVersion: string;
  reportId: string;
  reporterRole: (typeof REPORTER_ROLES)[number];
  counterpartyReference?: string;
  counterpartyFpi?: string;
  endpointReference?: string;
  interaction: {
    startedAt: string;
    endedAt: string;
    fhirVersion?: string;
    operation?: string;
    resourceType?: string;
    httpMethod?: string;
    httpStatus?: number;
  };
  outcome: (typeof OUTCOMES)[number];
  rating?: number;
  issues: Issue[];
}

export type ValidationResult =
  | { ok: true; value: InteractionReport }
  | { ok: false; detail: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function unknownKey(obj: Record<string, unknown>, allowed: Set<string>, where: string): string | null {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      // Sandbox choice: unknown properties are rejected, so free-form data
      // (which could hold patient data) cannot ride along in a report.
      return SAFE_NAME.test(k)
        ? `Unknown property "${k}" in ${where}.`
        : `Unknown property in ${where}.`;
    }
  }
  return null;
}

function optString(
  obj: Record<string, unknown>,
  key: string,
  where: string,
  max: number,
  pattern?: RegExp,
): string | { error: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0 || v.length > max) {
    return { error: `${where}${key} must be a non-empty string of at most ${max} characters.` };
  }
  if (pattern && !pattern.test(v)) return { error: `${where}${key} has an invalid format.` };
  return v;
}

/** Parse an RFC 3339 timestamp to epoch ms, or null if it is not one. */
export function parseRfc3339(v: unknown): number | null {
  if (typeof v !== 'string' || !RFC3339.test(v)) return null;
  const ms = Date.parse(v.toUpperCase());
  if (!Number.isFinite(ms)) return null;
  // Date.parse rolls 2026-02-30 over to March; refuse a date that does not exist.
  const [y, m, d] = v.slice(0, 10).split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return ms;
}

/**
 * Validate a parsed JSON body against the v0.2 contract. `now` is the server
 * clock in epoch ms. On success the value is normalized: reportId lowercased
 * and both timestamps rewritten in UTC.
 */
export function validateInteractionReport(body: unknown, now: number): ValidationResult {
  const fail = (detail: string): ValidationResult => ({ ok: false, detail });
  if (!isObject(body)) return fail('The body must be a JSON object.');

  const extra = unknownKey(body, TOP_KEYS, 'the report');
  if (extra) return fail(extra);

  if (body.schemaVersion !== SCHEMA_VERSION) {
    return fail(`schemaVersion is required and must be "${SCHEMA_VERSION}".`);
  }
  if (typeof body.reportId !== 'string' || !UUID_V4.test(body.reportId)) {
    return fail('reportId is required and must be a UUID version 4 in canonical hyphenated form.');
  }
  if (!REPORTER_ROLES.includes(body.reporterRole as never)) {
    return fail('reporterRole is required and must be "requester" or "responder".');
  }

  const counterpartyReference = optString(body, 'counterpartyReference', '', 130, FHIR_REF);
  if (counterpartyReference && typeof counterpartyReference === 'object') return fail(counterpartyReference.error);
  const counterpartyFpi = optString(body, 'counterpartyFpi', '', 36, UUID_ANY);
  if (counterpartyFpi && typeof counterpartyFpi === 'object') {
    return fail('counterpartyFpi must be a bare canonical UUID, with no "urn:uuid:" or resource-type prefix.');
  }
  const endpointReference = optString(body, 'endpointReference', '', 130, FHIR_REF);
  if (endpointReference && typeof endpointReference === 'object') return fail(endpointReference.error);
  if (typeof endpointReference === 'string' && !endpointReference.startsWith('Endpoint/')) {
    return fail('endpointReference must reference an Endpoint, as "Endpoint/<id>".');
  }

  // interaction
  const ix = body.interaction;
  if (!isObject(ix)) return fail('interaction is required and must be an object.');
  const ixExtra = unknownKey(ix, INTERACTION_KEYS, 'interaction');
  if (ixExtra) return fail(ixExtra);
  const started = parseRfc3339(ix.startedAt);
  const ended = parseRfc3339(ix.endedAt);
  if (started === null) return fail('interaction.startedAt is required and must be an RFC 3339 timestamp.');
  if (ended === null) return fail('interaction.endedAt is required and must be an RFC 3339 timestamp.');
  if (ended < started) return fail('interaction.endedAt must not precede interaction.startedAt.');
  if (started > now + FUTURE_SKEW_MS || ended > now + FUTURE_SKEW_MS) {
    return fail('Timestamps must not be in the future (five minutes of clock skew are allowed).');
  }
  if (ended < now - MAX_AGE_MS) {
    return fail('interaction.endedAt is more than thirty days old; reports must be submitted within thirty days.');
  }
  const interaction: InteractionReport['interaction'] = {
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
  };
  for (const [key, max, pattern] of [
    ['fhirVersion', 20, /^[0-9A-Za-z.\-]+$/],
    // An interaction name (search-type) or a FHIR operation ($everything).
    ['operation', 40, /^\$?[a-z][A-Za-z\-]*$/],
    ['resourceType', 64, RESOURCE_TYPE],
  ] as const) {
    const v = optString(ix, key, 'interaction.', max, pattern);
    if (v && typeof v === 'object') return fail(v.error);
    if (typeof v === 'string') interaction[key] = v;
  }
  if ('httpMethod' in ix) {
    if (!HTTP_METHODS.includes(ix.httpMethod as never)) {
      return fail(`interaction.httpMethod must be one of ${HTTP_METHODS.join(', ')}.`);
    }
    interaction.httpMethod = ix.httpMethod as string;
  }
  if ('httpStatus' in ix) {
    const s = ix.httpStatus;
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 100 || s > 599) {
      return fail('interaction.httpStatus must be an integer HTTP status (100 to 599). Omit it when there was no response; do not send 0.');
    }
    interaction.httpStatus = s;
  }

  if (!OUTCOMES.includes(body.outcome as never)) {
    return fail(`outcome is required and must be one of ${OUTCOMES.join(', ')}.`);
  }
  let rating: number | undefined;
  if ('rating' in body) {
    const r = body.rating;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) {
      return fail('rating must be an integer from 1 to 5. Omit it when no rating is given.');
    }
    rating = r;
  }

  // issues
  if (!Array.isArray(body.issues)) return fail('issues is required and must be an array; use [] when there are none.');
  if (body.issues.length > MAX_ISSUES) return fail(`issues may hold at most ${MAX_ISSUES} entries.`);
  const issues: Issue[] = [];
  for (let i = 0; i < body.issues.length; i++) {
    const it = body.issues[i];
    const at = `issues[${i}]`;
    if (!isObject(it)) return fail(`${at} must be an object.`);
    const itExtra = unknownKey(it, ISSUE_KEYS, at);
    if (itExtra) return fail(itExtra);
    // Own keys only: `in` would also accept names inherited from Object.prototype.
    if (typeof it.stage !== 'string' || !Object.hasOwn(ISSUE_VOCABULARY, it.stage)) {
      return fail(`${at}.stage is required and must be a stage from the issue vocabulary.`);
    }
    if (typeof it.code !== 'string') return fail(`${at}.code is required.`);
    // "other" is allowed with any stage; otherwise the code must belong to its stage.
    if (it.code !== 'other' && !ISSUE_VOCABULARY[it.stage].includes(it.code)) {
      return fail(`${at}.code is not an allowed code for stage "${it.stage}".`);
    }
    if (!SEVERITIES.includes(it.severity as never)) {
      return fail(`${at}.severity must be one of ${SEVERITIES.join(', ')}.`);
    }
    const issue: Issue = { stage: it.stage, code: it.code, severity: it.severity as Issue['severity'] };
    if ('description' in it) {
      const d = it.description;
      if (typeof d !== 'string' || d.trim().length === 0) return fail(`${at}.description must be a non-empty string.`);
      if (d.length > MAX_DESCRIPTION) return fail(`${at}.description may be at most ${MAX_DESCRIPTION} characters.`);
      issue.description = d;
    } else if (it.code === 'other') {
      return fail(`${at}.description is required when code is "other".`);
    }
    issues.push(issue);
  }

  const value: InteractionReport = {
    schemaVersion: SCHEMA_VERSION,
    reportId: (body.reportId as string).toLowerCase(),
    reporterRole: body.reporterRole as InteractionReport['reporterRole'],
    ...(typeof counterpartyReference === 'string' ? { counterpartyReference } : {}),
    // Echoed as submitted (proposal: "without any assertion that it was verified").
    ...(typeof counterpartyFpi === 'string' ? { counterpartyFpi } : {}),
    ...(typeof endpointReference === 'string' ? { endpointReference } : {}),
    interaction,
    outcome: body.outcome as InteractionReport['outcome'],
    ...(rating !== undefined ? { rating } : {}),
    issues,
  };
  return { ok: true, value };
}

/** JSON with object keys sorted at every level; array order is kept. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (isObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Hash of a validated report. Two submissions are "identical" when their
 * normalized values hash the same, so whitespace, property order, reportId
 * case and timestamp offsets do not count as a change.
 */
export function reportHash(r: InteractionReport): string {
  return createHash('sha256').update(canonicalJson(r)).digest('hex');
}

export interface Receipt {
  reportId: string;
  receivedAt: string;
  status: 'recorded';
  reporterOrganizationReference: string;
  summary: {
    reporterRole: string;
    counterpartyReference?: string;
    counterpartyFpi?: string;
    endpointReference?: string;
    outcome: string;
    rating?: number;
    issueCount: number;
    issueCodes: string[];
  };
}

export function buildReceipt(r: InteractionReport, receivedAt: Date, reporterRef: string): Receipt {
  const issueCodes: string[] = [];
  for (const i of r.issues) if (!issueCodes.includes(i.code)) issueCodes.push(i.code);
  return {
    reportId: r.reportId,
    // Whole seconds, like the proposal's example.
    receivedAt: receivedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    status: 'recorded',
    reporterOrganizationReference: reporterRef,
    summary: {
      reporterRole: r.reporterRole,
      ...(r.counterpartyReference ? { counterpartyReference: r.counterpartyReference } : {}),
      ...(r.counterpartyFpi ? { counterpartyFpi: r.counterpartyFpi } : {}),
      ...(r.endpointReference ? { endpointReference: r.endpointReference } : {}),
      outcome: r.outcome,
      ...(r.rating !== undefined ? { rating: r.rating } : {}),
      issueCount: r.issues.length,
      issueCodes,
    },
  };
}

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Content Too Large',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

export interface Problem {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
}

/** RFC 9457 Problem Details body. */
export function problem(status: number, detail: string): Problem {
  return { type: 'about:blank', title: TITLES[status] ?? 'Error', status, detail };
}

export function isReportId(v: string): boolean {
  return UUID_V4.test(v);
}
