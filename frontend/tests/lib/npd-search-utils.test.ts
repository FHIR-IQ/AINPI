import { describe, it, expect } from 'vitest';
import {
  stripCredentialSuffix,
  parseNameQuery,
  refToId,
  groupRolesBySpecialty,
  type RoleRow,
} from '@/lib/npd-search-utils';

describe('stripCredentialSuffix', () => {
  it('strips a single trailing suffix', () => {
    expect(stripCredentialSuffix('John Smith MD')).toBe('John Smith');
    expect(stripCredentialSuffix('Jane Doe DO')).toBe('Jane Doe');
    expect(stripCredentialSuffix('Kim Rogers NP')).toBe('Kim Rogers');
  });

  it('strips a suffix after a comma', () => {
    expect(stripCredentialSuffix('Smith, MD')).toBe('Smith');
    expect(stripCredentialSuffix('Doe, PharmD')).toBe('Doe');
  });

  it('handles hyphenated compound suffixes', () => {
    expect(stripCredentialSuffix('Alex Chen PA-C')).toBe('Alex Chen');
    expect(stripCredentialSuffix('Lee Wong FNP-BC')).toBe('Lee Wong');
  });

  it('handles generational suffixes', () => {
    expect(stripCredentialSuffix('John Smith Jr')).toBe('John Smith');
    expect(stripCredentialSuffix('Robert Downey III')).toBe('Robert Downey');
  });

  it('is case-insensitive', () => {
    expect(stripCredentialSuffix('Smith, md')).toBe('Smith');
    expect(stripCredentialSuffix('smith DO')).toBe('smith');
  });

  it('leaves names without suffixes unchanged', () => {
    expect(stripCredentialSuffix('Smith')).toBe('Smith');
    expect(stripCredentialSuffix('John Smith')).toBe('John Smith');
    expect(stripCredentialSuffix('Van Der Berg')).toBe('Van Der Berg');
  });

  it('does not strip substrings that aren\'t standalone tokens', () => {
    // "Medford" contains "MD" but should not be stripped
    expect(stripCredentialSuffix('Dr. Medford')).toBe('Dr. Medford');
    // "Podro" contains "PA" but should not be stripped
    expect(stripCredentialSuffix('Podro')).toBe('Podro');
  });

  it('collapses internal whitespace', () => {
    expect(stripCredentialSuffix('John   Smith')).toBe('John Smith');
  });
});

describe('parseNameQuery', () => {
  it('single token → family', () => {
    expect(parseNameQuery('Smith')).toEqual({ family: 'Smith', given: null });
  });

  it('First Last → given + family', () => {
    expect(parseNameQuery('John Smith')).toEqual({ family: 'Smith', given: 'John' });
  });

  it('Last, First → given + family (comma inverted)', () => {
    expect(parseNameQuery('Smith, John')).toEqual({ family: 'Smith', given: 'John' });
  });

  it('strips suffix before parsing', () => {
    expect(parseNameQuery('John Smith MD')).toEqual({ family: 'Smith', given: 'John' });
    expect(parseNameQuery('Smith, MD')).toEqual({ family: 'Smith', given: null });
  });

  it('handles middle names as part of given', () => {
    expect(parseNameQuery('John Michael Smith')).toEqual({ family: 'Smith', given: 'John Michael' });
  });

  it('handles empty input', () => {
    expect(parseNameQuery('')).toEqual({ family: null, given: null });
    expect(parseNameQuery('   ')).toEqual({ family: null, given: null });
    expect(parseNameQuery(', MD')).toEqual({ family: null, given: null });
  });
});

describe('refToId', () => {
  it('extracts id from a FHIR reference', () => {
    expect(refToId('Practitioner/Practitioner-1234567890')).toBe('Practitioner-1234567890');
    expect(refToId('Organization/Organization-abc-123')).toBe('Organization-abc-123');
  });

  it('handles null / undefined', () => {
    expect(refToId(null)).toBeNull();
    expect(refToId(undefined)).toBeNull();
    expect(refToId('')).toBeNull();
  });

  it('returns null if no slash', () => {
    expect(refToId('Practitioner-1234')).toBeNull();
  });
});

describe('groupRolesBySpecialty', () => {
  it('groups roles with the same specialty code', () => {
    const roles: RoleRow[] = [
      { _specialty_code: '207R00000X', _specialty_display: 'Internal Medicine', _org_id: 'Organization/Organization-A', _active: true },
      { _specialty_code: '207R00000X', _specialty_display: 'Internal Medicine', _org_id: 'Organization/Organization-B', _active: true },
      { _specialty_code: '207R00000X', _specialty_display: 'Internal Medicine', _org_id: 'Organization/Organization-C', _active: false },
    ];
    const grouped = groupRolesBySpecialty(roles);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].code).toBe('207R00000X');
    expect(grouped[0].role_count).toBe(3);
    expect(grouped[0].active_count).toBe(2);
    expect(grouped[0].org_ids).toHaveLength(3);
  });

  it('sorts by role_count descending', () => {
    const roles: RoleRow[] = [
      { _specialty_code: 'A', _specialty_display: 'A', _org_id: 'x', _active: true },
      { _specialty_code: 'B', _specialty_display: 'B', _org_id: 'x', _active: true },
      { _specialty_code: 'B', _specialty_display: 'B', _org_id: 'y', _active: true },
      { _specialty_code: 'B', _specialty_display: 'B', _org_id: 'z', _active: true },
      { _specialty_code: 'C', _specialty_display: 'C', _org_id: 'x', _active: true },
      { _specialty_code: 'C', _specialty_display: 'C', _org_id: 'y', _active: true },
    ];
    const grouped = groupRolesBySpecialty(roles);
    expect(grouped[0].code).toBe('B');  // 3 roles
    expect(grouped[1].code).toBe('C');  // 2 roles
    expect(grouped[2].code).toBe('A');  // 1 role
  });

  it('dedupes org_ids within a group', () => {
    const roles: RoleRow[] = [
      { _specialty_code: 'X', _specialty_display: 'X', _org_id: 'Organization/Organization-A', _active: true },
      { _specialty_code: 'X', _specialty_display: 'X', _org_id: 'Organization/Organization-A', _active: true },
      { _specialty_code: 'X', _specialty_display: 'X', _org_id: 'Organization/Organization-B', _active: true },
    ];
    const grouped = groupRolesBySpecialty(roles);
    expect(grouped[0].role_count).toBe(3);
    expect(grouped[0].org_ids).toHaveLength(2);  // only 2 distinct orgs
  });

  it('handles null specialty code', () => {
    const roles: RoleRow[] = [
      { _specialty_code: null, _specialty_display: null, _org_id: 'x', _active: true },
    ];
    const grouped = groupRolesBySpecialty(roles);
    expect(grouped[0].code).toBe('(none)');
    expect(grouped[0].display).toBe('(no display)');
  });

  it('returns empty array for empty input', () => {
    expect(groupRolesBySpecialty([])).toEqual([]);
  });
});
