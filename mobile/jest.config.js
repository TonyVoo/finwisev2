/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // `shared/` uses NodeNext-style `./foo.js` specifiers that resolve to `foo.ts`.
    // Jest, like Metro, resolves them literally; drop the extension and let
    // `moduleFileExtensions` pick the TypeScript source. See metro.config.js note 3.
    //
    // The backslashes must be doubled: this is a JS string, so `'\.'` collapses to `.`
    // and the pattern would match any character before `js` - including the `c` of
    // zod's internal `./v4/classic/external.cjs`, which then fails to resolve.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  // Jest's 5s default is a cold-start budget, not a per-assertion one. The first `it()` in
  // each screen suite pays for the whole jest-expo module graph, the RN renderer and the
  // SQLite instance the rest of its suite reuses, so on a slow machine that one test
  // exceeded 5s while every later test in the same file finished comfortably - six suites
  // failing on their first case and nowhere else. Raised far enough that cold start is
  // never the thing under test, and still low enough to catch a genuine hang.
  testTimeout: 30000,
};
