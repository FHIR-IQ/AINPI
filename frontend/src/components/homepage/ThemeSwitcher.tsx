'use client';

export type Theme = 'light' | 'dark' | 'minimal';

const THEMES: { value: Theme; label: string; icon: string }[] = [
  { value: 'light', label: 'Light cards', icon: '☀️' },
  { value: 'dark', label: 'Dark dashboard', icon: '🌙' },
  { value: 'minimal', label: 'Minimal map', icon: '⚡' },
];

const STORAGE_KEY = 'ainpi-theme';

/**
 * Resolve the initial theme on first render, in priority order:
 *   1. localStorage value (returning visitor's choice)
 *   2. prefers-color-scheme: dark → 'dark'
 *   3. fallback 'light'
 *
 * Safe to call during SSR (returns 'light' if window is undefined).
 */
export function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'minimal') {
    return stored;
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/** Persist the visitor's theme choice. */
export function persistTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, theme);
}

interface ThemeSwitcherProps {
  value: Theme;
  onChange: (next: Theme) => void;
}

export default function ThemeSwitcher({ value, onChange }: ThemeSwitcherProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Page style"
      className="inline-flex bg-white/90 backdrop-blur border border-slate-200 rounded-full p-1 gap-1 text-xs font-medium"
    >
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={t.value === value}
          aria-label={t.label}
          onClick={() => onChange(t.value)}
          className={`px-3 py-1.5 rounded-full transition-colors ${
            t.value === value
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span aria-hidden="true">{t.icon}</span> {t.label}
        </button>
      ))}
    </div>
  );
}
