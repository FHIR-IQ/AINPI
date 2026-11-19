import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Mirrors the asset/source rule in next.config.js: a .md import is its text.
const markdownAsText = {
  name: 'markdown-as-text',
  transform(code: string, id: string) {
    if (!id.endsWith('.md')) return null;
    return { code: `export default ${JSON.stringify(code)};`, map: null };
  },
};

export default defineConfig({
  plugins: [react(), markdownAsText],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx', 'scripts/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
