import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/findings-hub/StatusPill';

describe('StatusPill', () => {
  it('renders PUB label for published', () => {
    render(<StatusPill status="published" />);
    expect(screen.getByText('PUB')).toBeInTheDocument();
  });

  it('renders PRE label for pre-registered', () => {
    render(<StatusPill status="pre-registered" />);
    expect(screen.getByText('PRE')).toBeInTheDocument();
  });

  it('renders NULL label for null', () => {
    render(<StatusPill status="null" />);
    expect(screen.getByText('NULL')).toBeInTheDocument();
  });

  it('has an aria-label that names the status', () => {
    render(<StatusPill status="published" />);
    const pill = screen.getByLabelText('Status: published');
    expect(pill).toBeInTheDocument();
  });
});
