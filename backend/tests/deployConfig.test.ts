import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigForTests } from '../src/config.ts';

/**
 * Deployment files (`docs/DEPLOY.md`). None of them run in a test, so the checks pin what is easy to
 * get wrong silently and expensive to find out later: a secret baked into an image, a container that
 * runs as root, a production server that accepts the development signing key.
 */

const repo = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(repo, path), 'utf8');

describe('Dockerfile', () => {
  const dockerfile = read('backend/Dockerfile');

  it('exists, and builds from the repository root so the shared contract is in the image', () => {
    expect(dockerfile).toMatch(/^FROM node:22/m);
    expect(dockerfile).toMatch(/COPY shared\/?/);
    expect(dockerfile).toMatch(/COPY backend\/?/);
  });

  it('brings the shared TypeScript base config the backend extends', () => {
    expect(dockerfile).toMatch(/COPY tsconfig\.base\.json/);
  });

  it('installs exactly what the lockfile says', () => {
    expect(dockerfile).toMatch(/--frozen-lockfile/);
  });

  it('never copies an env file into the image', () => {
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
  });

  it('runs as a non-root user, in production mode', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/ENV NODE_ENV=production/);
  });

  it('asks the health endpoint whether it is up, and serves from the app directory', () => {
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/\/v1\/health/);
    expect(dockerfile).toMatch(/^WORKDIR \/app\/backend$/m);
    expect(dockerfile).toMatch(/CMD \["node", "--import", "tsx", "src\/server\.ts"\]/);
  });

  it('puts a dummy database address only where the build needs one, not in the final environment', () => {
    // `prisma generate` loads prisma.config.ts, which wants a DATABASE_URL to exist.
    expect(dockerfile).not.toMatch(/^ENV DATABASE_URL/m);
  });
});

describe('.dockerignore', () => {
  const lines = read('.dockerignore')
    .split('\n')
    .map((line) => line.trim());

  it.each(['.env', '.env.*', '**/node_modules', '.git', 'mobile', 'docs'])(
    'excludes %s',
    (entry) => {
      expect(lines).toContain(entry);
    },
  );

  it('lets the example env file through, which is documentation', () => {
    expect(lines).toContain('!backend/.env.example');
  });
});

describe('docker-compose.yml', () => {
  const compose = read('docker-compose.yml');

  it('is a local production-like trial only, with no real secret in it', () => {
    expect(compose).toMatch(/local trial/i);
    expect(compose).not.toMatch(/sk-|AIza|re_[A-Za-z0-9]{8}/);
  });

  it('does not publish the database to the host', () => {
    expect(compose).not.toMatch(/5432:5432/);
  });
});

describe('deploy guide', () => {
  const guide = read('docs/DEPLOY.md');

  it('covers the things the server cannot work out for itself', () => {
    for (const heading of [
      'TRUST_PROXY',
      'prune:tombstones',
      'migrate:deploy',
      'JWT_SECRET',
      '/v1/health',
    ]) {
      expect(guide).toContain(heading);
    }
  });

  it('exists where the release notes point', () => {
    expect(existsSync(join(repo, 'docs/DEPLOY.md'))).toBe(true);
    expect(read('docs/RELEASE.md')).toContain('docs/DEPLOY.md');
  });
});

describe('production configuration', () => {
  const saved = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    resetConfigForTests();
  });

  function configure(env: Record<string, string>) {
    Object.assign(process.env, { NODE_ENV: 'production' }, env);
    resetConfigForTests();
    return getConfig();
  }

  it('starts with a real signing key', () => {
    const secret = 'k9Zq3vXw7Rt2Lm8Pn5Bc1Hd6Fj4Sg0Ua-real-looking-secret';
    expect(configure({ JWT_SECRET: secret }).jwt.secret).toBe(secret);
  });

  it.each([
    'dev-only-insecure-secret-change-me-0000',
    'please-change-me-this-is-long-enough-123456',
    'CHANGE-ME-CHANGE-ME-CHANGE-ME-CHANGE-ME',
    'secret-secret-secret-secret-secret-secret',
    'x'.repeat(40),
  ])('refuses the placeholder signing key %s', (secret) => {
    expect(() => configure({ JWT_SECRET: secret })).toThrow(/JWT_SECRET/);
  });

  it('allows the development key outside production, where it is the point', () => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      JWT_SECRET: 'dev-only-insecure-secret-change-me-0000',
    });
    resetConfigForTests();
    expect(getConfig().jwt.secret).toContain('dev-only');
  });
});

describe('start.sh, for hosts with no pre-deploy command', () => {
  const script = read('backend/start.sh');

  it('stops if a migration fails, instead of starting the server on an old schema', () => {
    expect(script).toMatch(/^set -e$/m);
    const migrate = script.indexOf('prisma migrate deploy');
    expect(migrate).toBeGreaterThan(-1);
    expect(migrate).toBeLessThan(script.indexOf('exec node'));
  });

  it('finds prisma where the workspace installs it, one level above the backend', () => {
    expect(script).toContain('../node_modules/.bin/prisma migrate deploy');
  });

  it('does not need pnpm at run time: the image runs as a user it was not prepared for', () => {
    expect(script).not.toMatch(/^pnpm /m);
  });

  it("hands the process to node, so the host's stop signal reaches the graceful shutdown", () => {
    expect(script).toMatch(/^exec node --import tsx src\/server\.ts$/m);
  });

  it('is taken into the image with the rest of the backend, and documented by the command to type', () => {
    expect(read('backend/Dockerfile')).toMatch(/COPY backend\/ backend\//);
    expect(read('docs/DEPLOY.md')).toContain('`sh start.sh`');
  });
});
