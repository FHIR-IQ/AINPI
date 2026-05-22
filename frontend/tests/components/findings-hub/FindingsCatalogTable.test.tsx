import { describe, it, expect } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { FindingsCatalogTable } from '@/components/findings-hub/FindingsCatalogTable';
import type { CatalogRow } from '@/lib/hub-feed';

const rows: CatalogRow[] = [
  { hNumber: 'H40', title: 'Excluded billing Medicare Part B by HCPCS', slug: 'excluded-billing-medicare-partb-by-hcpcs', updated: '2026-05-22', status: 'published' },
  { hNumber: 'H42', title: 'Excluded telehealth-dominant post-exclusion', slug: 'excluded-telehealth-dominant-post-exclusion', updated: '2026-05-22', status: 'null' },
  { hNumber: 'H37', title: 'PECOS-NPPES taxonomy disagreement', slug: 'pecos-taxonomy-disagreement', updated: '2026-05-18', status: 'published' },
];

describe('FindingsCatalogTable', () => {
  it('renders a header row with H#, Finding, Updated, Status', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /H#/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Finding/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Updated/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Status/i })).toBeInTheDocument();
  });

  it('renders one body row per CatalogRow in the desktop table', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('H40')).toBeInTheDocument();
    expect(within(table).getByText('H42')).toBeInTheDocument();
    expect(within(table).getByText('H37')).toBeInTheDocument();
  });

  it('renders each title as a link to /findings/<slug>', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const table = screen.getByRole('table');
    const h40Link = within(table).getByRole('link', { name: /Excluded billing Medicare Part B by HCPCS/i });
    expect(h40Link).toHaveAttribute('href', '/findings/excluded-billing-medicare-partb-by-hcpcs');
  });

  it('renders the status pill text for each row', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('PUB').length).toBe(2);
    expect(within(table).getByText('NULL')).toBeInTheDocument();
  });

  it('default sort is latest updated desc; H40 (May 22) before H37 (May 18)', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const table = screen.getByRole('table');
    const bodyRows = within(table.querySelector('tbody')!).getAllByRole('row');
    const firstBody = bodyRows[0].textContent ?? '';
    const lastBody = bodyRows[2].textContent ?? '';
    expect(firstBody).toMatch(/H4[02]/);
    expect(lastBody).toContain('H37');
  });

  it('clicking the H# header toggles sort to ascending by H#', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const table = screen.getByRole('table');
    const hNumberHeader = within(table).getByRole('columnheader', { name: /H#/i });
    const button = within(hNumberHeader).getByRole('button', { name: /H#/i });
    fireEvent.click(button);
    const bodyRows = within(table.querySelector('tbody')!).getAllByRole('row');
    expect(bodyRows[0].textContent).toContain('H37');
  });

  it('sort headers have aria-sort attribute reflecting current state', () => {
    render(<FindingsCatalogTable rows={rows} />);
    const table = screen.getByRole('table');
    const updatedHeader = within(table).getByRole('columnheader', { name: /Updated/i });
    expect(updatedHeader).toHaveAttribute('aria-sort', 'descending'); // default
    const hNumberHeader = within(table).getByRole('columnheader', { name: /H#/i });
    expect(hNumberHeader).toHaveAttribute('aria-sort', 'none');
  });
});
