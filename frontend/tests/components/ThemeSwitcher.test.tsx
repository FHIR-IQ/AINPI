import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeSwitcher, { initialTheme, type Theme } from '@/components/homepage/ThemeSwitcher';

function setMatchMedia(prefersDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    setMatchMedia(false);
  });

  it('defaults to light when no localStorage and no system preference', () => {
    const onChange = vi.fn();
    render(<ThemeSwitcher value="light" onChange={onChange} />);
    expect(screen.getByRole('button', { name: /light cards/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows dark as selected when value="dark"', () => {
    render(<ThemeSwitcher value="dark" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /dark dashboard/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('calls onChange when a different theme is clicked', () => {
    const onChange = vi.fn();
    render(<ThemeSwitcher value="light" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /dark dashboard/i }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('exposes the three theme labels', () => {
    render(<ThemeSwitcher value="light" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /light cards/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dark dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /minimal map/i })).toBeInTheDocument();
  });
});

describe('initialTheme helper', () => {
  it('returns localStorage value when set', () => {
    localStorage.setItem('ainpi-theme', 'minimal');
    setMatchMedia(true);
    expect(initialTheme()).toBe('minimal');
  });

  it('returns dark when prefers-color-scheme: dark and no localStorage', () => {
    localStorage.clear();
    setMatchMedia(true);
    expect(initialTheme()).toBe('dark');
  });

  it('returns light when prefers-color-scheme: light and no localStorage', () => {
    localStorage.clear();
    setMatchMedia(false);
    expect(initialTheme()).toBe('light');
  });
});
