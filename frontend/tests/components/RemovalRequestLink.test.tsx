import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RemovalRequestLink from '@/components/RemovalRequestLink';

// The link every /npi/[npi] page renders (page.tsx footer). Synthetic NPI.
describe('RemovalRequestLink', () => {
  it('links to the removal form with the NPI prefilled', () => {
    render(<RemovalRequestLink npi="1234567893" />);
    const a = screen.getByRole('link', { name: 'Request removal of this page' });
    expect(a.getAttribute('href')).toBe('/privacy/remove?npi=1234567893');
  });

  it('never puts anything but an NPI into the URL', () => {
    render(<RemovalRequestLink npi={'"><script>'} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/privacy/remove');
  });
});
