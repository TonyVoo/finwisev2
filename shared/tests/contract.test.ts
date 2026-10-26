import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  API_ROUTES,
  ERROR_CODES,
  ERROR_CODE_STATUS,
  HTTP_METHODS,
  LIMITS,
  SYNC_ENTITIES,
  SYNC_PUSH_STATUSES,
  SYNC_RECORD_ERROR_CODES,
  routeKey,
  type HttpMethod,
} from '../src/index.js';

/**
 * Contract parity: `docs/api/openapi.yaml` is the source of truth for the HTTP surface,
 * and `shared/src` is the source of truth for the bodies. These tests fail the build
 * when the two disagree.
 *
 * Without them "the contract" is two documents that look like each other, and the first
 * person to edit one and forget the other ships a 404 or a silently-wrong field to a
 * device. That is exactly the drift this package exists to prevent, so the check has to
 * be mechanical rather than a review habit.
 */

const SPEC_PATH = new URL('../../docs/api/openapi.yaml', import.meta.url);

type Json = Record<string, unknown>;

const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as Json;

const paths = spec.paths as Record<string, Json>;
const components = spec.components as Json;
const schemas = components.schemas as Record<string, Json>;
const responses = components.responses as Record<string, Json>;

interface SpecOperation {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operation: Json;
}

/** Every (method, path) pair the spec actually declares. */
const specOperations: SpecOperation[] = Object.entries(paths).flatMap(([path, item]) =>
  HTTP_METHODS.filter((method) => item[method] !== undefined).map((method) => ({
    method,
    path,
    operation: item[method] as Json,
  })),
);

/** Resolve a local `$ref` one hop. Enough for this spec; it has no remote refs. */
function deref(node: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  const parts = ref.replace(/^#\//, '').split('/');
  let cursor: unknown = spec;
  for (const part of parts) {
    cursor = (cursor as Json)[part];
  }
  return cursor as Json;
}

function statusCodes(operation: Json): string[] {
  return Object.keys(operation.responses as Json);
}

function jsonContentSchemaName(container: Json): string | undefined {
  const content = container.content as Json | undefined;
  const media = content?.['application/json'] as Json | undefined;
  const ref = (media?.schema as Json | undefined)?.$ref;
  return typeof ref === 'string' ? ref.split('/').pop() : undefined;
}

describe('openapi document', () => {
  it('is OpenAPI 3.1', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('declares bearer auth as the only security scheme', () => {
    expect(Object.keys(components.securitySchemes as Json)).toEqual(['bearerAuth']);
  });

  it('applies bearer auth globally, so a new operation is authenticated by default', () => {
    // Opt-out is explicit (`security: []`) rather than opt-in. A forgotten `security`
    // block then fails closed instead of publishing an endpoint with no auth.
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });
});

describe('route table parity with API_ROUTES', () => {
  it('declares exactly the routes in API_ROUTES', () => {
    const inSpec = specOperations.map((op) => routeKey(op)).sort();
    const inCode = API_ROUTES.map((route) => routeKey(route)).sort();
    expect(inSpec).toEqual(inCode);
  });

  it.each(API_ROUTES)('$method $path matches the spec', (route) => {
    const found = specOperations.find((op) => routeKey(op) === routeKey(route));
    expect(found, `${routeKey(route)} is missing from openapi.yaml`).toBeDefined();
    const operation = found!.operation;

    expect(operation.operationId).toBe(route.operationId);

    // `security: []` on the operation is the opt-out from the global requirement.
    const isPublic = Array.isArray(operation.security) && operation.security.length === 0;
    expect(!isPublic, `auth flag for ${route.operationId}`).toBe(route.auth);

    const success = statusCodes(operation).filter((code) => code.startsWith('2'));
    expect(success, `${route.operationId} should declare exactly one 2xx`).toEqual([
      String(route.successStatus),
    ]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = specOperations.map((op) => op.operation.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prefixes every path with /v1 so the version is never implicit', () => {
    for (const path of Object.keys(paths)) {
      expect(path.startsWith('/v1/')).toBe(true);
    }
  });
});

describe('every operation is fully specified', () => {
  it.each(specOperations)('$method $path documents a response body or 204', ({ operation }) => {
    const success = statusCodes(operation).find((code) => code.startsWith('2'))!;
    const response = deref((operation.responses as Json)[success] as Json);
    if (success === '204') {
      expect(response.content).toBeUndefined();
    } else {
      expect(jsonContentSchemaName(response)).toBeTypeOf('string');
    }
  });

  it.each(specOperations.filter(({ method }) => method !== 'get' && method !== 'delete'))(
    '$method $path declares a required JSON request body',
    ({ operation }) => {
      const body = operation.requestBody as Json | undefined;
      expect(body).toBeDefined();
      expect(body!.required).toBe(true);
      expect(jsonContentSchemaName(body!)).toBeTypeOf('string');
    },
  );

  it.each(specOperations)('$method $path enumerates its error codes', ({ operation }) => {
    const codes = operation['x-errorCodes'];
    expect(Array.isArray(codes), 'x-errorCodes must be an array').toBe(true);
    expect((codes as string[]).length).toBeGreaterThan(0);
    for (const code of codes as string[]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });

  it.each(specOperations)(
    '$method $path uses only real codes for per-record errors',
    ({ operation }) => {
      for (const code of (operation['x-recordErrorCodes'] as string[] | undefined) ?? []) {
        expect(ERROR_CODES as readonly string[]).toContain(code);
      }
    },
  );

  it.each(specOperations)('$method $path documents at least one 4xx', ({ operation }) => {
    expect(statusCodes(operation).some((code) => code.startsWith('4'))).toBe(true);
  });

  it.each(specOperations)('$method $path documents a 500', ({ operation }) => {
    expect(statusCodes(operation)).toContain('500');
  });

  it.each(specOperations)(
    '$method $path returns the error envelope on every non-2xx',
    ({ operation }) => {
      for (const status of statusCodes(operation)) {
        if (status.startsWith('2')) continue;
        const response = deref((operation.responses as Json)[status] as Json);
        expect(jsonContentSchemaName(response), `${status} body`).toBe('ApiError');
      }
    },
  );

  it.each(specOperations.filter((op) => op.operation['x-errorCodes'] !== undefined))(
    '$method $path has a response status for each declared error code',
    ({ operation }) => {
      const declared = statusCodes(operation);
      for (const code of operation['x-errorCodes'] as string[]) {
        const status = String(ERROR_CODE_STATUS[code as keyof typeof ERROR_CODE_STATUS]);
        // 503 stands in for the health check's `internal_error`.
        expect(
          declared.includes(status) || (status === '500' && declared.includes('503')),
          `code ${code} maps to HTTP ${status}, which this operation does not declare`,
        ).toBe(true);
      }
    },
  );
});

describe('error envelope parity', () => {
  it('enumerates exactly the ERROR_CODES, in the same order', () => {
    expect((schemas.ErrorCode as Json).enum).toEqual([...ERROR_CODES]);
  });

  it('is a named schema with the documented envelope shape', () => {
    const envelope = schemas.ApiError as Json;
    expect(envelope.required).toEqual(['error']);
    expect(envelope.additionalProperties).toBe(false);
    const body = schemas.ApiErrorBody as Json;
    expect(body.required).toEqual(['code', 'message']);
    expect(Object.keys(body.properties as Json).sort()).toEqual(['code', 'details', 'message']);
  });

  it('documents the same HTTP status per code as ERROR_CODE_STATUS', () => {
    // The `ErrorCode` description carries a markdown table of code -> status. Parsing it
    // keeps the published table honest; a doc table nobody checks goes stale silently.
    const description = (schemas.ErrorCode as Json).description as string;
    const documented = new Map<string, number>();
    for (const line of description.split('\n')) {
      const match = /^\|\s*`([a-z_]+)`\s*\|\s*(\d{3})\s*\|/.exec(line.trim());
      if (match) documented.set(match[1]!, Number(match[2]));
    }
    expect(Object.fromEntries([...documented].sort())).toEqual(
      Object.fromEntries(Object.entries(ERROR_CODE_STATUS).sort()),
    );
  });

  it('reaches every error code from some operation, except reserved `forbidden`', () => {
    const used = new Set(
      specOperations.flatMap((op) => [
        // Codes returned as the HTTP status...
        ...((op.operation['x-errorCodes'] as string[]) ?? []),
        // ...and codes that only ever appear inside a per-record sync result.
        ...((op.operation['x-recordErrorCodes'] as string[]) ?? []),
      ]),
    );
    const unreachable = ERROR_CODES.filter((code) => !used.has(code));
    // Every code is reachable from some operation. `forbidden` became reachable with the
    // password-confirming endpoints; before that it was reserved.
    expect(unreachable).toEqual([]);
  });

  it('has a reusable response component per error status it serves', () => {
    for (const name of [
      'BadRequest',
      'Unauthorized',
      'Forbidden',
      'NotFound',
      'UnsupportedMediaType',
      'UnprocessableEntity',
      'RateLimited',
      'InternalError',
    ]) {
      expect(responses[name], `components.responses.${name}`).toBeDefined();
      expect(jsonContentSchemaName(responses[name]!)).toBe('ApiError');
    }
  });
});

describe('money, dates and times are modelled as decided', () => {
  it('states amountMinor is an integer in the minor unit', () => {
    const amount = schemas.AmountMinor as Json;
    expect(amount.type).toBe('integer');
    expect(amount.minimum).toBe(0);
    expect(amount.maximum).toBe(LIMITS.AMOUNT_MINOR_MAX);
    expect(amount.description as string).toMatch(/minor unit/i);
  });

  it('requires a 3-letter currency code', () => {
    expect((schemas.CurrencyCode as Json).pattern).toBe('^[A-Z]{3}$');
  });

  it('keeps the calendar date and the instant as separate schemas', () => {
    const date = schemas.CalendarDate as Json;
    const timestamp = schemas.Timestamp as Json;
    expect(date.format).toBe('date');
    expect(timestamp.format).toBe('date-time');
    expect(date).not.toEqual(timestamp);
  });

  it('documents the calendar date as zone-less and distinct from createdAt/updatedAt', () => {
    const description = (schemas.CalendarDate as Json).description as string;
    expect(description).toMatch(/no time and no zone/i);
    expect(description).toMatch(/Postgres `DATE`/);
    expect(description).toMatch(/different type from `Timestamp`/i);
  });

  it('documents the timestamp as timestamptz and distinct from the calendar date', () => {
    const description = (schemas.Timestamp as Json).description as string;
    expect(description).toMatch(/timestamptz/);
    expect(description).toMatch(/different type from `CalendarDate`/i);
  });

  it('gives an expense a calendar `date` and instant `createdAt`/`updatedAt`', () => {
    const properties = (schemas.Expense as Json).properties as Record<string, Json>;
    expect(properties.date!.allOf).toEqual([{ $ref: '#/components/schemas/CalendarDate' }]);
    expect(properties.createdAt!.$ref).toBe('#/components/schemas/CreatedAt');
    expect(properties.updatedAt!.$ref).toBe('#/components/schemas/UpdatedAt');
    for (const name of ['CreatedAt', 'UpdatedAt'] as const) {
      expect((schemas[name] as Json).allOf).toEqual([{ $ref: '#/components/schemas/Timestamp' }]);
    }
  });
});

describe('sync contract parity', () => {
  const pull = (paths['/v1/sync'] as Json).get as Json;
  const push = (paths['/v1/sync'] as Json).post as Json;

  function queryParam(operation: Json, name: string): Json {
    const found = (operation.parameters as Json[]).find((p) => p.name === name);
    expect(found, `parameter ${name}`).toBeDefined();
    return found!;
  }

  it('discriminates every sync union on exactly the SYNC_ENTITIES', () => {
    for (const name of ['SyncChange', 'SyncPushItem', 'SyncPushResult'] as const) {
      const discriminator = (schemas[name] as Json).discriminator as Json;
      expect(discriminator.propertyName, name).toBe('entity');
      expect(Object.keys(discriminator.mapping as Json).sort()).toEqual([...SYNC_ENTITIES].sort());
    }
  });

  it('points every discriminator mapping at a named schema', () => {
    // A discriminator cannot select an inline subschema; generators silently emit an
    // untagged union when it tries to, and the client loses the narrowing on `record`.
    for (const name of ['SyncChange', 'SyncPushItem', 'SyncPushResult'] as const) {
      const union = schemas[name] as Json;
      const mapping = (union.discriminator as Json).mapping as Record<string, string>;
      const branches = (union.oneOf as Json[]).map((branch) => branch.$ref);
      for (const target of Object.values(mapping)) {
        expect(branches, `${name} mapping -> ${target}`).toContain(target);
        expect(schemas[target.split('/').pop()!], target).toBeDefined();
      }
    }
  });

  describe('GET /v1/sync', () => {
    it('documents `since` as a revision watermark and not a timestamp', () => {
      const since = queryParam(pull, 'since');
      expect(since.schema).toEqual({ $ref: '#/components/schemas/Revision' });
      expect(since.description as string).toMatch(/revision/i);
      expect(since.description as string).toMatch(/not.{0,3}\*{0,2}\s*a timestamp/i);
      expect((schemas.Revision as Json).description as string).toMatch(/per-user monotonic/i);
      expect(pull.description as string).toMatch(/is a revision, not a timestamp/i);
    });

    it('bounds `limit` by the shared LIMITS', () => {
      const limit = queryParam(pull, 'limit').schema as Json;
      expect(limit.maximum).toBe(LIMITS.SYNC_PULL_MAX_LIMIT);
      expect(limit.default).toBe(LIMITS.SYNC_PULL_DEFAULT_LIMIT);
    });

    it('returns changes[], nextCursor, hasMore and resyncRequired', () => {
      const response = schemas.SyncPullResponse as Json;
      expect(response.required).toEqual([
        'changes',
        'nextCursor',
        'hasMore',
        'resyncRequired',
        'serverTime',
      ]);
      const properties = response.properties as Record<string, Json>;
      expect((properties.changes!.items as Json).$ref).toBe('#/components/schemas/SyncChange');
      expect(properties.nextCursor!.allOf).toEqual([{ $ref: '#/components/schemas/Revision' }]);
      expect(properties.hasMore!.type).toBe('boolean');
      expect(properties.resyncRequired!.type).toBe('boolean');
    });

    it('documents the 90-day tombstone horizon as the resyncRequired trigger', () => {
      const resync = ((schemas.SyncPullResponse as Json).properties as Record<string, Json>)
        .resyncRequired!.description as string;
      expect(resync).toMatch(
        new RegExp(`${LIMITS.TOMBSTONE_HORIZON_DAYS}-day tombstone horizon`, 'i'),
      );
      expect(resync).toMatch(/pull again from `since=0`/i);
      expect(pull.description as string).toMatch(
        new RegExp(`${LIMITS.TOMBSTONE_HORIZON_DAYS} days after deletion`, 'i'),
      );
    });
  });

  describe('POST /v1/sync', () => {
    it('takes a batch of { entity, id, fields, updatedAt, clientMutationId }', () => {
      for (const branch of ['CategorySyncPushItem', 'ExpenseSyncPushItem'] as const) {
        expect((schemas[branch] as Json).required).toEqual([
          'entity',
          'id',
          'updatedAt',
          'clientMutationId',
          'fields',
        ]);
      }
    });

    it('bounds the batch by LIMITS.SYNC_MAX_BATCH_SIZE', () => {
      const changes = ((schemas.SyncPushRequest as Json).properties as Record<string, Json>)
        .changes!;
      expect(changes.minItems).toBe(1);
      expect(changes.maxItems).toBe(LIMITS.SYNC_MAX_BATCH_SIZE);
      expect(statusCodes(push)).toContain('413');
    });

    it('answers per record with exactly the SYNC_PUSH_STATUSES', () => {
      expect((schemas.SyncPushStatus as Json).enum).toEqual([...SYNC_PUSH_STATUSES]);
      const results = ((schemas.SyncPushResponse as Json).properties as Record<string, Json>)
        .results!;
      expect(results.type).toBe('array');
      expect((results.items as Json).$ref).toBe('#/components/schemas/SyncPushResult');
    });

    it('carries the authoritative server row on every result, conflicts included', () => {
      for (const [branch, entity] of [
        ['CategorySyncPushResult', 'Category'],
        ['ExpenseSyncPushResult', 'Expense'],
      ] as const) {
        const record = ((schemas[branch] as Json).properties as Record<string, Json>).record!;
        expect(record.oneOf).toEqual([
          { $ref: `#/components/schemas/${entity}` },
          { type: 'null' },
        ]);
        expect(record.description as string).toMatch(/authoritative server row/i);
        expect(record.description as string).toMatch(/conflict_server_wins/);
      }
      expect((schemas.SyncPushResult as Json).description as string).toMatch(
        /authoritative server row/i,
      );
    });

    it('documents last-write-wins on updatedAt with the now + 5min clamp', () => {
      const clampMinutes = LIMITS.CLIENT_CLOCK_SKEW_CLAMP_MS / 60_000;
      const updatedAt = (schemas.SyncPushUpdatedAt as Json).description as string;
      expect(updatedAt).toMatch(/last-write-wins orders on this/i);
      expect(updatedAt).toMatch(new RegExp(`now \\+ ${clampMinutes} minutes`));
      expect(push.description as string).toMatch(/Last-write-wins, with the clock clamped/i);
      expect(push.description as string).toMatch(new RegExp(`now \\+ ${clampMinutes} minutes`));
      // Ties must go to the server, or the outcome is not deterministic.
      expect((schemas.SyncPushStatus as Json).description as string).toMatch(
        /newer than or equal/i,
      );
    });

    it('publishes exactly the per-record error codes the server may return', () => {
      // The server asserts this set too, so a code it can emit but the spec does not
      // list is a build failure rather than an unhandled branch on a device.
      expect(((push['x-recordErrorCodes'] as string[]) ?? []).slice().sort()).toEqual(
        [...SYNC_RECORD_ERROR_CODES].sort(),
      );
    });

    it('documents clientMutationId idempotency', () => {
      const description = (schemas.ClientMutationId as Json).description as string;
      expect(description).toMatch(/idempotency key/i);
      expect(description).toMatch(/reused across\s+\*{0,2}retries/i);
      expect(description).toMatch(/mutation_id_reused/);
      const replay = (schemas.SyncPushIdempotentReplay as Json).description as string;
      expect(replay).toMatch(/replayed/i);
    });

    it('documents categories-before-expenses batch ordering', () => {
      expect(push.description as string).toMatch(/Ordering within a batch/i);
      expect(push.description as string).toMatch(
        /all `category` items before all `expense` items/i,
      );
      expect((schemas.SyncChange as Json).description as string).toMatch(
        /all `category` items,\s+then all `expense` items/i,
      );
    });

    it('documents fields as an upsert-with-merge partial', () => {
      for (const name of ['CategorySyncFields', 'ExpenseSyncFields'] as const) {
        const fields = schemas[name] as Json;
        expect(fields.additionalProperties).toBe(false);
        expect(fields.minProperties).toBe(1);
        expect(fields.required).toBeUndefined();
        expect(fields.description as string).toMatch(/upsert/i);
        expect(fields.description as string).toMatch(/merge/i);
        expect(Object.keys(fields.properties as Json)).toContain('deletedAt');
      }
    });
  });
});

describe('limits are published, not hard-coded on each side', () => {
  it('matches the shared LIMITS for list pagination', () => {
    const limit = ((paths['/v1/expenses'] as Json).get as Json).parameters as Json[];
    const schema = limit.find((p) => p.name === 'limit')!.schema as Json;
    expect(schema.maximum).toBe(LIMITS.EXPENSE_LIST_MAX_LIMIT);
    expect(schema.default).toBe(LIMITS.EXPENSE_LIST_DEFAULT_LIMIT);
  });

  it('matches the shared LIMITS for field lengths', () => {
    expect((schemas.CategoryName as Json).maxLength).toBe(LIMITS.CATEGORY_NAME_MAX);
    expect((schemas.ExpenseNote as Json).maxLength).toBe(LIMITS.EXPENSE_NOTE_MAX);
    expect((schemas.Password as Json).minLength).toBe(LIMITS.PASSWORD_MIN);
    expect((schemas.Password as Json).maxLength).toBe(LIMITS.PASSWORD_MAX);
    expect((schemas.Email as Json).maxLength).toBe(LIMITS.EMAIL_MAX);
  });
});

describe('tenancy', () => {
  it('never accepts a userId from the client', () => {
    // Tenancy comes from the access token. A `userId` anywhere in a request shape would
    // be an endpoint that can be pointed at another user's data.
    const requestSchemas = specOperations
      .map(({ operation }) => operation.requestBody as Json | undefined)
      .filter((body): body is Json => body !== undefined)
      .map((body) => jsonContentSchemaName(body)!);

    const seen = new Set<string>();
    const collect = (name: string): string[] => {
      if (seen.has(name)) return [];
      seen.add(name);
      const schema = schemas[name];
      if (schema === undefined) return [];
      const keys = Object.keys((schema.properties as Json | undefined) ?? {});
      const nested = JSON.stringify(schema)
        .match(/#\/components\/schemas\/\w+/g)
        ?.map((ref) => ref.split('/').pop()!)
        .flatMap(collect);
      return [...keys, ...(nested ?? [])];
    };

    const allKeys = requestSchemas.flatMap(collect);
    expect(allKeys).not.toContain('userId');
    expect(allKeys.length).toBeGreaterThan(0);
  });

  it('reports cross-tenant rows as 404 rather than 403', () => {
    const notFound = responses.NotFound as Json;
    expect(notFound.description as string).toMatch(/owned by\s+another user/i);
    // `Forbidden` exists now, for the password-confirming endpoints - and says in so many
    // words that it is not the cross-tenant answer.
    expect((responses.Forbidden as Json).description as string).toMatch(/password/i);
    expect((responses.Forbidden as Json).description as string).toMatch(/404 not_found/);
    const resourceId = (components.parameters as Record<string, Json>).ResourceId!;
    expect(resourceId.description as string).toMatch(/404/);
  });
});
