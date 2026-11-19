/**
 * Codes for the NPD MCP working group sign-up (/npd-mcp). The codes are what
 * the database stores; the labels are what the form and the public list show.
 */

export type OrgType = 'payer' | 'provider' | 'vendor' | 'app' | 'hie' | 'government' | 'other';

export type Participation = 'implement' | 'test' | 'standards' | 'use_case';

export const ORG_TYPES: readonly { code: OrgType; label: string }[] = [
  { code: 'payer', label: 'Payer' },
  { code: 'provider', label: 'Provider or health system' },
  { code: 'vendor', label: 'EHR or directory vendor' },
  { code: 'app', label: 'App developer' },
  { code: 'hie', label: 'HIE or network' },
  { code: 'government', label: 'Government' },
  { code: 'other', label: 'Other' },
];

export const PARTICIPATION: readonly { code: Participation; label: string }[] = [
  { code: 'implement', label: 'Implement the tools' },
  { code: 'test', label: 'Test at the connectathon' },
  { code: 'standards', label: 'Draft or review standards' },
  { code: 'use_case', label: 'Bring a use case' },
];

export function orgTypeLabel(code: string): string {
  return ORG_TYPES.find((t) => t.code === code)?.label ?? 'Other';
}
