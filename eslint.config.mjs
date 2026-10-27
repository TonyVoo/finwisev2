// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/*.d.ts',
      // Generated Prisma client: a build artifact, and not ours to style.
      'backend/src/db/generated/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // The palette is React state now (`useColors`). The static `color` export is the light
    // palette, kept for tests; importing it into a component would pin that component to
    // light mode and nothing else would notice.
    files: ['mobile/src/**/*.{ts,tsx}', 'mobile/app/**/*.{ts,tsx}'],
    ignores: ['mobile/src/theme/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/theme/tokens'],
              importNames: ['color', 'lightColor', 'darkColor'],
              message:
                'Use useColors() / createStyles() from theme/ThemeProvider so the component follows the theme.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Build-tool config files are loaded by their tools through `require`, not by a
    // bundler, so CommonJS is the only thing they can be. Metro and Babel in particular
    // read these before any transform is in play.
    files: ['**/*.config.js', '**/*.config.cjs', '**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
