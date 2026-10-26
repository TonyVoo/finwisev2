import { createSqliteLocalStore } from '@/db/localStore';
import { migrate } from '@/db/migrations';
import {
  clearCategoryReviewPending,
  markCategoryReviewPending,
  readCategoryReviewPending,
} from '@/db/onboarding';
import { createTestDatabase, type TestDatabase } from '../support/sqlite';

const USER_A = '0192f5a0-0000-7000-8000-00000000a001';
const USER_B = '0192f5a0-0000-7000-8000-00000000b001';

describe('the category-review flag', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = createTestDatabase();
    await migrate(database);
  });

  afterEach(() => database.close());

  it('is off until a signup turns it on, and clearing turns it off', async () => {
    expect(await readCategoryReviewPending(database)).toBe(false);

    await markCategoryReviewPending(database);
    expect(await readCategoryReviewPending(database)).toBe(true);

    await clearCategoryReviewPending(database);
    expect(await readCategoryReviewPending(database)).toBe(false);
  });

  it('is idempotent in both directions', async () => {
    await markCategoryReviewPending(database);
    await markCategoryReviewPending(database);
    expect(await readCategoryReviewPending(database)).toBe(true);

    await clearCategoryReviewPending(database);
    await clearCategoryReviewPending(database);
    expect(await readCategoryReviewPending(database)).toBe(false);
  });

  it('does not carry over to the next account that signs in on this device', async () => {
    const store = createSqliteLocalStore(database);
    await store.adopt(USER_A);
    await markCategoryReviewPending(database);

    // A different user signs in: the prompt that was meant for A must not greet B.
    await store.adopt(USER_B);

    expect(await readCategoryReviewPending(database)).toBe(false);
  });

  it('is wiped on logout, so a later login on the same device is not prompted', async () => {
    const store = createSqliteLocalStore(database);
    await store.adopt(USER_A);
    await markCategoryReviewPending(database);

    await store.clear();

    expect(await readCategoryReviewPending(database)).toBe(false);
  });
});
