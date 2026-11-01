import { ApiRequestError } from '@/api/errors';
import { isSpaceGone } from '@/api/errors';
import { migrate } from '@/db/migrations';
import { META_KEYS, writeMeta } from '@/db/meta';
import { createActiveSpaceSource } from '@/household/spaces';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

describe('the active space, as the API client sees it', () => {
  let database: TestDatabase;
  beforeEach(async () => {
    database = await createTestDatabase();
    await migrate(database);
  });
  afterEach(() => database.close());

  it('is the space the store holds, read each time so a switch takes effect at once', async () => {
    const source = createActiveSpaceSource(database);
    expect(await source.getSpaceId()).toBeNull();

    await writeMeta(database, META_KEYS.dataScope, 'space-1');
    expect(await source.getSpaceId()).toBe('space-1');

    await writeMeta(database, META_KEYS.dataScope, 'space-2');
    expect(await source.getSpaceId()).toBe('space-2');
  });
});

describe('isSpaceGone', () => {
  const error = (init: Partial<ConstructorParameters<typeof ApiRequestError>[0]>) =>
    new ApiRequestError({ status: 404, code: 'not_found', message: 'x', ...init });

  it('is true only for the 404 that names the X-Space-Id header', () => {
    expect(isSpaceGone(error({ details: { header: 'X-Space-Id' } }))).toBe(true);
    expect(isSpaceGone(error({}))).toBe(false);
    expect(isSpaceGone(error({ details: { header: 'Other' } }))).toBe(false);
    expect(isSpaceGone(error({ status: 409, code: 'household_limit' }))).toBe(false);
    expect(isSpaceGone(new Error('offline'))).toBe(false);
  });
});
