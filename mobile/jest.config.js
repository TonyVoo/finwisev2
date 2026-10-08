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
};
