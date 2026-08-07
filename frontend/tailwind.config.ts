import type { Config } from 'tailwindcss'
import typography from '@tailwindcss/typography'

/**
 * Design system: "the published record."
 *
 * AINPI is a public-interest audit of federal data, so the register is an
 * institutional publication rather than a dashboard. Three decisions carry
 * most of the weight, and they are made here rather than in 51 page files:
 *
 * 1. The neutral ramp is warm (archival paper), not the blue-gray Tailwind
 *    default. Every existing `bg-gray-50` / `border-gray-200` inherits it.
 * 2. Radius collapses to near-zero. Editorial layouts are built from rules
 *    and alignment, not rounded floating cards.
 * 3. Shadows become hairlines. A shadow says "this floats above the page";
 *    a rule says "this is part of the page." We want the second.
 *
 * The accent blue is the same value as the darkest step of the map ramp
 * (#08519c), so interface chrome and data visualisation agree instead of
 * competing.
 */
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Warm neutral ramp. Replaces Tailwind's cool gray everywhere it is
        // already used, which is how the whole site changes tone at once.
        gray: {
          50: '#faf8f5',
          100: '#f2efe9',
          200: '#e4dfd6',
          300: '#cec7ba',
          400: '#a49b8c',
          500: '#7d7466',
          600: '#5d564b',
          700: '#443e36',
          800: '#2b2621',
          900: '#171310',
          950: '#0d0a08',
        },
        primary: {
          50: '#eef4fb',
          100: '#d6e4f5',
          200: '#adc9ea',
          300: '#7ba7db',
          400: '#4a81c7',
          500: '#2a63ad',
          600: '#08519c',
          700: '#073f78',
          800: '#062f59',
          900: '#04213e',
        },
        paper: '#faf8f5',
        ink: '#171310',
        // Reserved for a flagged or failing state. Used sparingly; when
        // everything is highlighted, nothing is.
        signal: '#a8321c',
      },
      fontFamily: {
        // Newsreader for display: an editorial serif built for news reading,
        // which is the tone an audit record should carry.
        serif: ['var(--font-display)', 'Georgia', 'serif'],
        // IBM Plex Sans for interface and dense tables: institutional,
        // technical, and it ships genuinely good tabular figures.
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Tighter tracking as size increases, which is what makes large
        // editorial type look set rather than scaled.
        '5xl': ['3rem', { lineHeight: '1.04', letterSpacing: '-0.022em' }],
        '4xl': ['2.25rem', { lineHeight: '1.08', letterSpacing: '-0.02em' }],
        '3xl': ['1.75rem', { lineHeight: '1.14', letterSpacing: '-0.017em' }],
        '2xl': ['1.375rem', { lineHeight: '1.22', letterSpacing: '-0.012em' }],
        xl: ['1.15rem', { lineHeight: '1.36', letterSpacing: '-0.008em' }],
      },
      borderRadius: {
        DEFAULT: '2px',
        md: '2px',
        lg: '3px',
        xl: '3px',
        '2xl': '4px',
      },
      boxShadow: {
        // Hairlines rather than blurs. Depth comes from the rule, not a glow.
        sm: '0 1px 0 0 rgba(23,19,16,0.05)',
        DEFAULT: '0 1px 0 0 rgba(23,19,16,0.06)',
        md: '0 1px 0 0 rgba(23,19,16,0.06)',
        lg: '0 1px 2px 0 rgba(23,19,16,0.08)',
        xl: '0 2px 8px -2px rgba(23,19,16,0.10)',
      },
    },
  },
  plugins: [typography],
}
export default config
