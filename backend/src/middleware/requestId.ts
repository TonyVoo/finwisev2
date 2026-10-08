import type { NextFunction, Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';

const HEADER = 'X-Request-Id';
/** Don't echo an unbounded or junk client-supplied value into our logs. */
const CLIENT_ID_PATTERN = /^[\w.:-]{1,128}$/;

/**
 * Assign every request a correlation id and echo it as `X-Request-Id`.
 *
 * Set first, before anything that can fail, so that even a 415 or a 500 carries the id —
 * the contract tells clients to quote it in bug reports, which only works if every
 * response has one.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.get(HEADER);
  const id = supplied && CLIENT_ID_PATTERN.test(supplied) ? supplied : uuidv7();
  req.requestId = id;
  res.setHeader(HEADER, id);
  next();
}
