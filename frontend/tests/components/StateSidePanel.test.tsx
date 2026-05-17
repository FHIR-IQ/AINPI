import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StateSidePanel from '@/components/homepage/StateSidePanel';

describe('StateSidePanel', () => {
  it('renders nothing when no state is selected', () => {
    const { container } = render(<StateSidePanel state={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders state name and cohort count when open', () => {
    render(
      <StateSidePanel
        state={{ code: 'VA', name: 'Virginia', cohortSize: 125 }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Virginia')).toBeInTheDocument();
    expect(screen.getByText(/125/)).toBeInTheDocument();
    expect(screen.getByText(/federally-excluded NPIs/i)).toBeInTheDocument();
  });

  it('has a Download CSV link with the correct per-state URL', () => {
    render(
      <StateSidePanel
        state={{ code: 'VA', name: 'Virginia', cohortSize: 125 }}
        onClose={vi.fn()}
      />,
    );
    const csvLink = screen.getByRole('link', { name: /download cohort csv/i });
    expect(csvLink).toHaveAttribute(
      'href',
      '/api/v1/states/va-cohort-critical.csv',
    );
  });

  it('has an Open full state report link to /for-state-medicaid/<state>', () => {
    render(
      <StateSidePanel
        state={{ code: 'TX', name: 'Texas', cohortSize: 404 }}
        onClose={vi.fn()}
      />,
    );
    const reportLink = screen.getByRole('link', { name: /open full state report/i });
    expect(reportLink).toHaveAttribute('href', '/for-state-medicaid/tx');
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <StateSidePanel
        state={{ code: 'VA', name: 'Virginia', cohortSize: 125 }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
