import { describe, expect, it } from 'vitest';
import { SUBSTACK_URL, substackSubscribeUrl } from '@/lib/newsletter';

describe('substackSubscribeUrl', () => {
  it('prefills and encodes the address', () => {
    expect(substackSubscribeUrl(' a+b@example.com ')).toBe(
      `${SUBSTACK_URL}/subscribe?email=a%2Bb%40example.com`,
    );
  });

  it('falls back to the bare subscribe page', () => {
    expect(substackSubscribeUrl()).toBe(`${SUBSTACK_URL}/subscribe`);
    expect(substackSubscribeUrl('  ')).toBe(`${SUBSTACK_URL}/subscribe`);
  });
});
