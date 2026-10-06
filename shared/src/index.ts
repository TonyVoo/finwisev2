/**
 * `@expense-tracker/shared` - the wire contract.
 *
 * Every request and response body of the API is declared here exactly once, as a zod
 * schema. The backend validates incoming requests with these schemas; the mobile client
 * infers its TypeScript types from the same declarations. There are no hand-written
 * interfaces sitting alongside, so the two sides cannot drift: changing a wire shape
 * without changing this package breaks the build.
 *
 * The companion human-readable document is `docs/api/openapi.yaml`, which is the source
 * of truth for the HTTP surface (statuses, headers, error codes per endpoint). A test in
 * this package asserts the two stay in agreement.
 */

export * from './primitives.js';
export * from './errors.js';
export * from './syncable.js';
export * from './user.js';
export * from './auth.js';
export * from './category.js';
export * from './expense.js';
export * from './sync.js';
export * from './health.js';
export * from './routes.js';
