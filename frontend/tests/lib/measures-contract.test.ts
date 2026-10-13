import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ApiV1Measure,
  ApiV1MeasureComparability,
  ApiV1MeasurePoint,
  ApiV1Measures,
  ApiV1MeasureSource,
} from '@/lib/api-v1-types';
import { KNOWN_RELEASES } from '@/lib/release';

/**
 * TypeScript types are erased before they ever see the JSON, and the JSON is
 * written by Python. So "measures.json parses against ApiV1Measures" has to be
 * checked at runtime, field by field, or it is not checked at all. That gap is
 * the one analysis/contract_schemas.py was written to close for findings.
 */

const FILE = join(__dirname, '..', '..', 'public', 'api', 'v1', 'measures.json');
const raw: unknown = JSON.parse(readFileSync(FILE, 'utf8'));

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function checkSource(s: unknown, where: string): asserts s is ApiV1MeasureSource {
  if (!isObj(s)) throw new Error(`${where}: source is not an object`);
  if (!isStr(s.file)) throw new Error(`${where}: source.file`);
  if (!isStr(s.field)) throw new Error(`${where}: source.field`);
  if (!(s.commit === null || isStr(s.commit))) throw new Error(`${where}: source.commit`);
  if (typeof s.vendored !== 'boolean') throw new Error(`${where}: source.vendored`);
}

const COMPARABILITY: ApiV1MeasureComparability[] = [true, false, 'unreviewed', null];

function checkPoint(p: unknown, unit: string, where: string): asserts p is ApiV1MeasurePoint {
  if (!isObj(p)) throw new Error(`${where}: point is not an object`);
  if (!isStr(p.release) || !ISO.test(p.release)) throw new Error(`${where}: release`);
  if (!isNum(p.value) || !isNum(p.numerator) || !isNum(p.denominator)) {
    throw new Error(`${where}: value/numerator/denominator must be numbers`);
  }
  if (p.denominator <= 0) throw new Error(`${where}: denominator must be positive`);
  if (!Number.isInteger(p.definition_version)) throw new Error(`${where}: definition_version`);
  if (!COMPARABILITY.includes(p.comparable_to_previous as ApiV1MeasureComparability)) {
    throw new Error(`${where}: comparable_to_previous ${String(p.comparable_to_previous)}`);
  }
  checkSource(p.source, where);
  const expected = unit === 'count' ? p.numerator : p.numerator / p.denominator;
  if (Math.abs(p.value - expected) > 1e-12) throw new Error(`${where}: value disagrees with numerator/denominator`);
  if (p.numerator === 0 && !isStr(p.zero_control)) throw new Error(`${where}: zero without a positive control`);
}

function checkMeasure(m: unknown, where: string): asserts m is ApiV1Measure {
  if (!isObj(m)) throw new Error(`${where}: not an object`);
  for (const k of ['slug', 'question', 'source'] as const) {
    if (!isStr(m[k])) throw new Error(`${where}: ${k}`);
  }
  if (m.unit !== 'ratio' && m.unit !== 'count') throw new Error(`${where}: unit`);
  if (m.time_axis !== 'ndh-release') throw new Error(`${where}: time_axis`);
  if (!Array.isArray(m.definitions) || m.definitions.length === 0) throw new Error(`${where}: definitions`);
  if (!Array.isArray(m.breaks) || !Array.isArray(m.series) || !Array.isArray(m.omitted)) {
    throw new Error(`${where}: breaks/series/omitted must be arrays`);
  }
  if (!isObj(m.ordinary_move) || !isNum(m.ordinary_move.max)) throw new Error(`${where}: ordinary_move`);
  m.series.forEach((p, i) => checkPoint(p, m.unit as string, `${where}.series[${i}]`));
}

function assertMeasures(v: unknown): asserts v is ApiV1Measures {
  if (!isObj(v)) throw new Error('measures.json is not an object');
  if (!isStr(v.generated_at) || !isStr(v.generator) || !isStr(v.note)) throw new Error('header fields');
  if (!Array.isArray(v.releases) || !Array.isArray(v.measures) || !Array.isArray(v.excluded_candidates)) {
    throw new Error('releases/measures/excluded_candidates must be arrays');
  }
  v.measures.forEach((m, i) => checkMeasure(m, `measures[${i}]`));
}

describe('/api/v1/measures.json', () => {
  it('parses against ApiV1Measures', () => {
    expect(() => assertMeasures(raw)).not.toThrow();
  });

  assertMeasures(raw);
  const doc: ApiV1Measures = raw;

  it('only names releases this project has ingested', () => {
    for (const r of doc.releases) expect(KNOWN_RELEASES).toContain(r);
    expect([...doc.releases].sort()).toEqual(doc.releases);
  });

  it('has unique slugs', () => {
    const slugs = doc.measures.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('accounts for every release in every measure, as a point or a stated omission', () => {
    for (const m of doc.measures) {
      const seen = [...m.series.map((p) => p.release), ...m.omitted.map((o) => o.release)].sort();
      expect(seen, m.slug).toEqual(doc.releases);
      for (const o of m.omitted) expect(o.reason.length, m.slug).toBeGreaterThan(0);
    }
  });

  it('keeps each series ascending, with null comparability only on the first point', () => {
    for (const m of doc.measures) {
      const rel = m.series.map((p) => p.release);
      expect([...rel].sort(), m.slug).toEqual(rel);
      m.series.forEach((p, i) => {
        if (i === 0) expect(p.comparable_to_previous, m.slug).toBeNull();
        else expect(p.comparable_to_previous, m.slug).not.toBeNull();
      });
    }
  });

  it('records every break on a release in its series, with the break deciding comparability', () => {
    for (const m of doc.measures) {
      for (const b of m.breaks) {
        const after = m.series.find((p) => p.release === b.at);
        expect(after, `${m.slug} break at ${b.at}`).toBeDefined();
        expect(after!.definition_version).toBe(b.to_version);
        expect(after!.comparable_to_previous).toBe(b.comparable_across_break);
      }
      const versions = new Set(m.definitions.map((d) => d.version));
      for (const p of m.series) expect(versions.has(p.definition_version), m.slug).toBe(true);
    }
  });

  it('never draws the role-specialty agreement across the 2026-08-20 vocabulary break', () => {
    const m = doc.measures.find((x) => x.slug === 'role-specialty-agreement');
    expect(m).toBeDefined();
    expect(m!.series.at(-1)!.comparable_to_previous).toBe(false);
  });
});
