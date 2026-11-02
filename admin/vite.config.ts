import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { mockApi } from './dev/mockApi.ts';

/**
 * The admin page (`docs/design/17-admin.md`). Built into `backend/admin-dist`, which the backend serves at
 * `/admin`; `base` is that path, so the built page asks for `/admin/assets/...`.
 */
export default defineConfig({
  base: '/admin/',
  // `ADMIN_MOCK=1` serves a fake admin API in the dev server, for working on the look without a backend.
  plugins: [react(), ...(process.env.ADMIN_MOCK === '1' ? [mockApi()] : [])],
  build: {
    outDir: '../backend/admin-dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    // `pnpm --filter @expense-tracker/admin dev` against a backend on :3000.
    proxy: { '/v1': 'http://localhost:3000', '/admin/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
