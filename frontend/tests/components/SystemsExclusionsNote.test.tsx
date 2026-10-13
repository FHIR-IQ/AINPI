import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SystemsExclusionsNote from '@/components/connectivity/SystemsExclusionsNote';

const excluded = {
  note: 'Billing, revenue-cycle, management and staffing vendors.',
  rows: [
    {
      system_key: 'brand:COBIUS',
      label: 'COBIUS',
      reason: 'listed third-party vendor',
      organizations: 415,
      practitioners: 15427,
    },
  ],
};

const outOfState = {
  note: 'Endpoints a system would have reached only through an out-of-state member.',
  count: 1028,
  kept_from_members_without_state: 23,
  rows: [
    {
      system: 'JEFFERSON',
      via_member: 'JEFFERSON RADIOLOGY',
      member_state: 'CT',
      url: 'https://app.meldrx.com/api/fhir/ei-jefferson',
      vendor: null,
    },
  ],
};

describe('SystemsExclusionsNote', () => {
  it('renders both blocks in plain language when present', () => {
    render(<SystemsExclusionsNote excluded={excluded} outOfState={outOfState} />);
    const note = screen.getByTestId('systems-exclusions-note');
    expect(note.textContent).toContain('415 organizations carry');
    expect(note.textContent).toContain('COBIUS, 415');
    expect(note.textContent).toContain('standalone organization');
    expect(note.textContent).toContain('1,028');
    expect(note.textContent).toContain('web addresses were');
    expect(note.textContent).toContain('another state');
    expect(note.textContent).toContain('23');
    expect(note.textContent).toContain('no recorded state');
    // Plain language: no payload field names leak into the copy.
    expect(note.textContent).not.toContain('excluded_third_party');
    expect(note.textContent).not.toContain('PractitionerRole');
  });

  it('renders nothing when both blocks are absent', () => {
    const { container } = render(
      <SystemsExclusionsNote excluded={undefined} outOfState={undefined} />,
    );
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('systems-exclusions-note')).toBeNull();
  });

  it('renders only the block that is present', () => {
    render(<SystemsExclusionsNote excluded={undefined} outOfState={outOfState} />);
    const note = screen.getByTestId('systems-exclusions-note');
    expect(note.textContent).toContain('Endpoints left out');
    expect(note.textContent).not.toContain('Not counted as systems');
  });

  it('says so when a block is present but empty', () => {
    render(
      <SystemsExclusionsNote
        excluded={{ ...excluded, rows: [] }}
        outOfState={{ ...outOfState, count: 0, kept_from_members_without_state: 0, rows: [] }}
      />,
    );
    const note = screen.getByTestId('systems-exclusions-note');
    expect(note.textContent).toContain('No billing, revenue-cycle or staffing vendor names');
    expect(note.textContent).toContain('No system reached an endpoint only through');
    expect(note.textContent).not.toContain('no recorded state');
  });

  it('uses the singular for one organization', () => {
    render(
      <SystemsExclusionsNote
        excluded={{ ...excluded, rows: [{ ...excluded.rows[0], organizations: 1 }] }}
        outOfState={undefined}
      />,
    );
    expect(screen.getByTestId('systems-exclusions-note').textContent).toContain(
      '1 organization carries',
    );
  });
});
