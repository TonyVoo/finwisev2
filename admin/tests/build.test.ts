import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

/**
 * The built page is committed (`backend/admin-dist`), so the image needs no build step: a free host's builder
 * ran out of memory compiling it. That is only safe while the committed build is the build of the current
 * source. This builds the source again and compares, so a change to `admin/` that was not followed by
 * `pnpm --filter @expense-tracker/admin build` fails here instead of shipping the old page.
 */

const adminDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const committed = join(adminDir, '..', 'backend', 'admin-dist');

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: false })
    .map(String)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

describe('the committed build', () => {
  it('is the build of the current source', async () => {
    const out = mkdtempSync(join(tmpdir(), 'admin-build-'));
    // Vitest runs with NODE_ENV=test, which would bundle React's development build; the real build is production.
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await build({
        mode: 'production',
        root: adminDir,
        configFile: join(adminDir, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir: out, emptyOutDir: true },
      });

      const fresh = filesUnder(out);
      expect(filesUnder(committed), 'run: pnpm --filter @expense-tracker/admin build').toEqual(
        fresh,
      );
      for (const name of fresh) {
        expect(
          readFileSync(join(committed, name)).equals(readFileSync(join(out, name))),
          `${relative(adminDir, join(committed, name))} is out of date`,
        ).toBe(true);
      }
    } finally {
      process.env.NODE_ENV = before;
      rmSync(out, { recursive: true, force: true });
    }
  });
});
