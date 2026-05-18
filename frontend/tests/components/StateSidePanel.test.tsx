import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StateSidePanel, { type SidePanelState } from '@/components/homepage/StateSidePanel';

function makeState(overrides: Partial<SidePanelState> = {}): SidePanelState {
  return {
    code: 'VA',
    name: 'Virginia',
    cohortSize: 125,
    audit: {
      medicaid: {
        strictMatches: 0,
        fullWindowMatches: 28,
        strictPaid: 0,
        fullWindowPaid: 8_500_000,
      },
      partbPartd: {
        partbMatches: 8,
        partdMatches: 10,
        opioidPrescribers: 6,
      },
      deactivatedBilling: {
        matches: 3,
        multiSource: 1,
      },
      industryPayments: {
        strictMatches: 2,
        fullWindowMatches: 9,
        strictPaid: 167_000,
      },
      sampleNpi: '1801070313',
    },
    ...overrides,
  };
}

describe('StateSidePanel', () => {
  it('renders nothing when no state is selected', () => {
    const { container } = render(<StateSidePanel state={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders state name and cohort count when open', () => {
    render(<StateSidePanel state={makeState()} onClose={vi.fn()} />);
    expect(screen.getByText('Virginia')).toBeInTheDocument();
    expect(screen.getByText(/125/)).toBeInTheDocument();
    expect(screen.getByText(/federally-excluded NPIs/i)).toBeInTheDocument();
  });

  it('has a Download CSV link with the correct per-state URL', () => {
    render(<StateSidePanel state={makeState()} onClose={vi.fn()} />);
    const csvLink = screen.getByRole('link', { name: /download cohort csv/i });
    expect(csvLink).toHaveAttribute(
      'href',
      '/api/v1/states/va-cohort-critical.csv',
    );
  });

  it('has an Open full state report link to /for-state-medicaid/<state>', () => {
    render(
      <StateSidePanel
        state={makeState({ code: 'TX', name: 'Texas', cohortSize: 404 })}
        onClose={vi.fn()}
      />,
    );
    const reportLink = screen.getByRole('link', { name: /open full state report/i });
    expect(reportLink).toHaveAttribute('href', '/for-state-medicaid/tx');
  });

  it('has a Verify a sample NPI link to NPPES Registry', () => {
    render(<StateSidePanel state={makeState()} onClose={vi.fn()} />);
    const verifyLink = screen.getByRole('link', {
      name: /verify a sample NPI on NPPES Registry/i,
    });
    expect(verifyLink).toHaveAttribute(
      'href',
      'https://npiregistry.cms.hhs.gov/provider-view/1801070313',
    );
    expect(verifyLink).toHaveAttribute('target', '_blank');
  });

  it('omits the Verify NPI CTA when sampleNpi is empty', () => {
    render(
      <StateSidePanel
        state={makeState({
          audit: { ...makeState().audit, sampleNpi: '' },
        })}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('link', { name: /verify a sample NPI/i }),
    ).toBeNull();
  });

  it('renders the five summary rows with audit data', () => {
    render(<StateSidePanel state={makeState()} onClose={vi.fn()} />);
    // Medicaid row
    expect(screen.getByText(/Medicaid spending/i)).toBeInTheDocument();
    expect(screen.getByText(/0 of 28 matched/i)).toBeInTheDocument();
    // Part B + D row with opioid count
    expect(screen.getByText(/8 Part B · 10 Part D billers/i)).toBeInTheDocument();
    expect(screen.getByText(/opioid prescriber/i)).toBeInTheDocument();
    // DEA-coordination warning shown for >0 opioid prescribers
    expect(screen.getByText(/DEA-coordination signal/i)).toBeInTheDocument();
    // Deactivated still billing
    expect(screen.getByText(/NPPES-deactivated still billing/i)).toBeInTheDocument();
    expect(screen.getByText(/3 closed-identifier matches/i)).toBeInTheDocument();
    // Open Payments
    expect(screen.getByText(/Open Payments × exclusion/i)).toBeInTheDocument();
    expect(screen.getByText(/2 of 9 strict post-exclusion/i)).toBeInTheDocument();
    // Directory hygiene
    expect(screen.getByText(/Directory hygiene context/i)).toBeInTheDocument();
    expect(screen.getByText(/99.99984%/)).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<StateSidePanel state={makeState()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
