import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { problems } from '../errors.ts';
import { toIssues } from '../http/issues.ts';

/**
 * Request validation, driven by the zod schemas in `@expense-tracker/shared`.
 *
 * Those schemas are the same objects the mobile client infers its types from, so a
 * handler cannot accept a shape the client was not told about, and vice versa. They are
 * `strictObject`s, which is what makes an unexpected key a `400 validation_error`
 * instead of a silently-ignored field — a typo'd `ammountMinor` should fail, not
 * quietly write a zero.
 */

/**
 * Validate and replace `req.body`.
 *
 * Replacing matters: the handler then sees the parsed value (trimmed strings, coerced
 * numbers, defaults filled in) and has no way to reach around the schema to the raw
 * input.
 */
export function validateBody<S extends z.ZodType>(schema: S): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    // body-parser leaves `req.body` undefined when the request carried no body at all.
    // That is "you forgot the body", not "a field failed validation".
    if (req.body === undefined || req.body === null) {
      next(problems.malformedRequest('A JSON request body is required.'));
      return;
    }
    if (typeof req.body !== 'object' || Array.isArray(req.body)) {
      next(problems.malformedRequest('Request body must be a JSON object.'));
      return;
    }

    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(problems.validation('Request body failed validation.', toIssues(result.error)));
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate the query string.
 *
 * Express 5 makes `req.query` a getter, so the parsed result is stashed under
 * `res.locals` and read back with {@link validatedQuery} rather than assigned over.
 */
export function validateQuery<S extends z.ZodType>(schema: S): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(problems.validation('Query parameters failed validation.', toIssues(result.error)));
      return;
    }
    res.locals.query = result.data;
    next();
  };
}

/** Read what {@link validateQuery} parsed. */
export function validatedQuery<S extends z.ZodType>(res: Response, _schema: S): z.infer<S> {
  return res.locals.query as z.infer<S>;
}

/** Validate path parameters — in practice `{ id: Uuid }`. */
export function validateParams<S extends z.ZodType>(schema: S): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      // A malformed id is a bad request, not a 404: the client sent something that is
      // not an id at all, which is worth telling it plainly.
      next(problems.validation('Path parameters failed validation.', toIssues(result.error)));
      return;
    }
    res.locals.params = result.data;
    next();
  };
}

/** Read what {@link validateParams} parsed. */
export function validatedParams<S extends z.ZodType>(res: Response, _schema: S): z.infer<S> {
  return res.locals.params as z.infer<S>;
}
