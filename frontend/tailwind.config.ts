import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93bbfd',
          400: '#609afa',
          500: '#3b76f6',
          600: '#2557eb',
          700: '#1d42d8',
          800: '#1e36af',
          900: '#1e318a',
        },
      },
    },
  },
  plugins: [],
}
export default config
