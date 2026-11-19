import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const list = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/npd-mcp-participants', () => ({ listPublicParticipants: list.fn }));
vi.mock('@/components/Navbar', () => ({ default: () => null }));

import NpdMcpPage, { metadata, revalidate } from '@/app/npd-mcp/page';

async function renderPage() {
  render(await NpdMcpPage());
}

beforeEach(() => {
  list.fn.mockReset();
  list.fn.mockResolvedValue([]);
});

describe('/npd-mcp page', () => {
  it('renders the doc title as the h1', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Open-source MCP tools for the National Provider Directory' }),
    ).toBeInTheDocument();
  });

  it('renders the doc sections, the join link and the form', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 2, name: 'Tool goals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Join the working group' }).getAttribute('href')).toBe('#join');
    expect(document.getElementById('join')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });

  it('shows the empty state when nobody has opted in', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { name: 'Who has joined' })).toBeInTheDocument();
    expect(screen.getByText('Be the first to sign up.')).toBeInTheDocument();
  });

  it('renders an organization name containing markup as text', async () => {
    list.fn.mockResolvedValue([{ organization: '<script>alert(1)</script>', orgType: 'payer' }]);
    const { container } = render(await NpdMcpPage());
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.queryByText('Be the first to sign up.')).toBeNull();
  });

  it('maps the orgType code to its label', async () => {
    list.fn.mockResolvedValue([
      { organization: 'Acme Health', orgType: 'payer' },
      { organization: 'Beta Labs', orgType: 'vendor' },
    ]);
    await renderPage();
    const items = screen.getAllByRole('listitem').filter((li) => li.closest('[data-testid="participants"]'));
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Acme Health'),
      expect.stringContaining('Beta Labs'),
    ]);
    expect(items[0].textContent).toContain('Payer');
    expect(items[1].textContent).toContain('EHR or directory vendor');
  });

  it('renders the disclaimer once', async () => {
    await renderPage();
    expect(
      screen.getAllByText(
        'Independent open-source work by AINPI. Not produced, reviewed, or endorsed by CMS or the NPD team.',
      ),
    ).toHaveLength(1);
  });

  it('revalidates every 10 minutes and has a description Google keeps', () => {
    expect(revalidate).toBe(600);
    expect(metadata.title).toBe('NPD MCP working group');
    expect(String(metadata.description).length).toBeGreaterThan(50);
  });
});
