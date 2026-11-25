import { describe, expect, it } from 'vitest';

import {
  buildReceipt,
  canonicalJson,
  reportHash,
  validateInteractionReport,
} from '@/lib/interaction-report';

const NOW = Date.parse('2026-11-01T00:00:00Z');

// The four comment-free bodies from the proposal's "Complete examples".
const FAILURE = {
  schemaVersion: '1.0',
  reportId: '984fc279-674a-4f06-8a59-98135df762ca',
  reporterRole: 'requester',
  counterpartyReference: 'Organization/org-b',
  counterpartyFpi: '13e068e1-cd54-5baa-b7e3-79761afe7afc',
  endpointReference: 'Endpoint/endpoint-b',
  interaction: {
    startedAt: '2026-10-29T14:00:00Z',
    endedAt: '2026-10-29T14:00:02Z',
    fhirVersion: '4.0.1',
    operation: 'search-type',
    resourceType: 'Organization',
    httpMethod: 'GET',
    httpStatus: 401,
  },
  outcome: 'failure',
  rating: 2,
  issues: [
    {
      stage: 'authentication',
      code: 'credentials-rejected',
      severity: 'error',
      description: 'The endpoint rejected the presented credentials.',
    },
  ],
};
const SUCCESS = {
  ...FAILURE,
  reportId: '0f1f0e6c-2a44-4b63-9a7e-6f1a2c3d4e5f',
  interaction: { ...FAILURE.interaction, startedAt: '2026-10-29T15:10:00Z', endedAt: '2026-10-29T15:10:01Z', httpStatus: 200 },
  outcome: 'success',
  rating: 5,
  issues: [],
};
const RESPONDER = {
  schemaVersion: '1.0',
  reportId: 'c3a7b1e2-5d48-4f90-8c21-7b6e9d0a4f33',
  reporterRole: 'responder',
  counterpartyReference: 'Organization/org-a',
  endpointReference: 'Endpoint/endpoint-b',
  interaction: FAILURE.interaction,
  outcome: 'success',
  issues: [
    {
      stage: 'authentication',
      code: 'credentials-rejected',
      severity: 'information',
      description: 'Presented credentials were not recognized, so the request was rejected as designed.',
    },
  ],
};
const DISCOVERY = {
  schemaVersion: '1.0',
  reportId: '7b2d9c40-8e13-4a55-b6f7-1c2d3e4f5a6b',
  reporterRole: 'requester',
  counterpartyFpi: '5e4c4d18-0725-58ce-9477-d8482ea11016',
  interaction: { startedAt: '2026-10-29T16:20:00Z', endedAt: '2026-10-29T16:20:00Z' },
  outcome: 'failure',
  issues: [
    {
      stage: 'directory-discovery',
      code: 'endpoint-missing',
      severity: 'error',
      description: 'The organization was located but no active endpoint record was published.',
    },
  ],
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const reject = (body: unknown) => {
  const r = validateInteractionReport(body, NOW);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.detail;
};

describe('validateInteractionReport: proposal examples', () => {
  it.each([
    ['requester failure', FAILURE],
    ['requester success', SUCCESS],
    ['responder', RESPONDER],
    ['pre-request discovery failure', DISCOVERY],
  ])('accepts the %s example', (_, body) => {
    expect(validateInteractionReport(body, NOW).ok).toBe(true);
  });
});

describe('validateInteractionReport: rejections', () => {
  it('requires schemaVersion 1.0', () => {
    reject({ ...FAILURE, schemaVersion: '2.0' });
  });
  it('requires a UUID v4 reportId', () => {
    reject({ ...FAILURE, reportId: '13e068e1-cd54-5baa-b7e3-79761afe7afc' }); // v5
    reject({ ...FAILURE, reportId: 'not-a-uuid' });
  });
  it('rejects an unknown property without echoing its value', () => {
    const d = reject({ ...FAILURE, patientName: 'Jane Doe' });
    expect(d).toContain('patientName');
    expect(d).not.toContain('Jane');
  });
  it('rejects a code from a different stage, and allows "other" with any stage', () => {
    const b = clone(FAILURE);
    b.issues[0].code = 'timeout';
    reject(b);
    b.issues[0].code = 'other';
    expect(validateInteractionReport(b, NOW).ok).toBe(true);
  });
  it('requires a description for code "other"', () => {
    const b = clone(FAILURE);
    b.issues[0] = { stage: 'other', code: 'other', severity: 'warning' } as never;
    expect(reject(b)).toContain('description');
  });
  it('rejects stage "other" with a specific code', () => {
    const b = clone(FAILURE);
    b.issues[0].stage = 'other';
    reject(b);
  });
  it('enforces the timestamp rules', () => {
    const b = clone(FAILURE);
    b.interaction.endedAt = '2026-10-29T13:59:59Z';
    expect(reject(b)).toContain('precede');
    const future = clone(FAILURE);
    future.interaction.startedAt = '2026-11-01T00:06:00Z';
    future.interaction.endedAt = '2026-11-01T00:06:00Z';
    reject(future);
    const old = clone(FAILURE);
    old.interaction.startedAt = '2026-09-01T00:00:00Z';
    old.interaction.endedAt = '2026-09-01T00:00:00Z';
    reject(old);
    const notRfc = clone(FAILURE);
    notRfc.interaction.startedAt = '2026-10-29 14:00:00';
    reject(notRfc);
  });
  it('allows four minutes of future skew', () => {
    const b = clone(FAILURE);
    b.interaction.startedAt = '2026-11-01T00:04:00Z';
    b.interaction.endedAt = '2026-11-01T00:04:00Z';
    expect(validateInteractionReport(b, NOW).ok).toBe(true);
  });
  it('rejects httpStatus 0 and a non-integer rating', () => {
    const b = clone(FAILURE);
    b.interaction.httpStatus = 0;
    reject(b);
    reject({ ...FAILURE, rating: 4.5 });
    reject({ ...FAILURE, rating: 6 });
  });
  it('caps issues at 50 and descriptions at 1000 characters', () => {
    const many = clone(SUCCESS) as typeof FAILURE;
    many.issues = Array.from({ length: 51 }, () => clone(FAILURE.issues[0]));
    reject(many);
    const long = clone(FAILURE);
    long.issues[0].description = 'x'.repeat(1001);
    reject(long);
  });
  it('rejects an FPI with a urn prefix and a non-Endpoint endpointReference', () => {
    reject({ ...FAILURE, counterpartyFpi: 'urn:uuid:13e068e1-cd54-5baa-b7e3-79761afe7afc' });
    reject({ ...FAILURE, endpointReference: 'Organization/org-b' });
  });
  it('requires issues to be an array', () => {
    const { issues: _drop, ...noIssues } = FAILURE;
    reject(noIssues);
  });
});

describe('normalization and hashing', () => {
  it('lowercases reportId and normalizes offsets to UTC', () => {
    const b = clone(FAILURE);
    b.reportId = b.reportId.toUpperCase();
    b.interaction.startedAt = '2026-10-29T10:00:00-04:00';
    const r = validateInteractionReport(b, NOW);
    if (!r.ok) throw new Error(r.detail);
    expect(r.value.reportId).toBe(FAILURE.reportId);
    expect(r.value.interaction.startedAt).toBe('2026-10-29T14:00:00.000Z');
  });
  it('hashes equal for reordered keys, different for changed content', () => {
    const a = validateInteractionReport(FAILURE, NOW);
    const reordered = JSON.parse(canonicalJson(FAILURE));
    const b = validateInteractionReport(reordered, NOW);
    const c = validateInteractionReport({ ...FAILURE, rating: 3 }, NOW);
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture');
    expect(reportHash(a.value)).toBe(reportHash(b.value));
    expect(reportHash(a.value)).not.toBe(reportHash(c.value));
  });
});

describe('buildReceipt', () => {
  it('matches the proposal receipt shape', () => {
    const r = validateInteractionReport(FAILURE, NOW);
    if (!r.ok) throw new Error(r.detail);
    expect(buildReceipt(r.value, new Date('2026-10-29T14:00:05.123Z'), 'NpdMcpParticipant/p1')).toEqual({
      reportId: FAILURE.reportId,
      receivedAt: '2026-10-29T14:00:05Z',
      status: 'recorded',
      reporterOrganizationReference: 'NpdMcpParticipant/p1',
      summary: {
        reporterRole: 'requester',
        counterpartyReference: 'Organization/org-b',
        counterpartyFpi: '13e068e1-cd54-5baa-b7e3-79761afe7afc',
        endpointReference: 'Endpoint/endpoint-b',
        outcome: 'failure',
        rating: 2,
        issueCount: 1,
        issueCodes: ['credentials-rejected'],
      },
    });
  });
  it('omits absent optional values and lists distinct codes in first-seen order', () => {
    const b = clone(DISCOVERY) as typeof FAILURE;
    b.issues.push(clone(b.issues[0]), { stage: 'connection', code: 'timeout', severity: 'error' } as never);
    const r = validateInteractionReport(b, NOW);
    if (!r.ok) throw new Error(r.detail);
    const s = buildReceipt(r.value, new Date(NOW), 'x').summary;
    expect(s).not.toHaveProperty('rating');
    expect(s).not.toHaveProperty('counterpartyReference');
    expect(s.issueCount).toBe(3);
    expect(s.issueCodes).toEqual(['endpoint-missing', 'timeout']);
  });
});


describe('review fixes', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'rejects inherited name %s as a stage with a 400, never a throw',
    (stage) => {
      const b = clone(FAILURE);
      b.issues[0] = { stage, code: 'other', severity: 'error', description: 'x' } as never;
      expect(() => validateInteractionReport(b, NOW)).not.toThrow();
      reject(b);
      b.issues[0] = { stage, code: 'timeout', severity: 'error' } as never;
      expect(() => validateInteractionReport(b, NOW)).not.toThrow();
      reject(b);
    },
  );
  it('accepts a FHIR operation name such as $everything', () => {
    const b = clone(FAILURE);
    b.interaction.operation = '$everything';
    expect(validateInteractionReport(b, NOW).ok).toBe(true);
  });
  it('rejects a calendar date that does not exist', () => {
    const b = clone(FAILURE);
    b.interaction.startedAt = '2026-02-30T00:00:00Z';
    reject(b);
  });
  it('echoes counterpartyFpi as submitted', () => {
    const upper = FAILURE.counterpartyFpi.toUpperCase();
    const r = validateInteractionReport({ ...FAILURE, counterpartyFpi: upper }, NOW);
    if (!r.ok) throw new Error(r.detail);
    expect(r.value.counterpartyFpi).toBe(upper);
  });
});
