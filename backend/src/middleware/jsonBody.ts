import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { problems } from '../errors.ts';

/** Matches the contract's note that an oversized body is `413 batch_too_large`. */
const BODY_LIMIT = '1mb';

/** Does this request actually carry a body? */
function hasBody(req: Request): boolean {
  if (req.get('transfer-encoding') !== undefined) return true;
  const length = req.get('content-length');
  return length !== undefined && length !== '0';
}

/**
 * Reject a request whose body is not JSON, before trying to parse it.
 *
 * Express's json parser silently ignores a body with a different content type, which
 * would surface as a confusing `validation_error` about missing fields. The contract
 * says `415 unsupported_media_type`, so say that.
 */
export function requireJsonContentType(req: Request, _res: Response, next: NextFunction): void {
  if (hasBody(req) && !req.is('application/json')) {
    next(problems.unsupportedMediaType());
    return;
  }
  next();
}

/**
 * `express.json`, with the body limit the contract documents.
 *
 * Annotated as `RequestHandler` rather than inferred: body-parser's own return type
 * names a type from `@types/connect`, which is a transitive dependency and so not
 * nameable from here under `declaration`.
 */
const standardParser: RequestHandler = express.json({ limit: BODY_LIMIT, strict: true });

/** Receipt uploads carry an image as base64; 1,500,000 decoded bytes is 2,000,000 chars. */
const RECEIPT_BODY_LIMIT = '3mb';
const receiptParser: RequestHandler = express.json({ limit: RECEIPT_BODY_LIMIT, strict: true });
const RECEIPT_PUT = /^\/v1\/expenses\/[^/]+\/receipt$/;
const RECEIPT_SCAN = '/v1/receipts/scan';

/** Does this request carry a receipt image? The upload and the reading both do. */
function carriesReceipt(req: Request): boolean {
  return (
    (req.method === 'PUT' && RECEIPT_PUT.test(req.path)) ||
    (req.method === 'POST' && req.path === RECEIPT_SCAN)
  );
}

export const parseJsonBody: RequestHandler = (req, res, next) => {
  (carriesReceipt(req) ? receiptParser : standardParser)(req, res, next);
};

/**
 * Translate body-parser's own failures into contract error codes.
 *
 * Must be registered immediately after the parser: body-parser reports these as generic
 * errors with a `type`, and without this they would land in the catch-all handler as
 * `500 internal_error` for what is plainly a client mistake.
 */
export function jsonBodyErrors(
  error: unknown,
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (error !== null && typeof error === 'object' && 'type' in error) {
    switch ((error as { type: unknown }).type) {
      case 'entity.parse.failed':
        next(problems.malformedRequest('Request body is not valid JSON.'));
        return;
      case 'entity.too.large':
        next(
          problems.batchTooLarge(
            `Request body exceeds the ${
              carriesReceipt(req) ? RECEIPT_BODY_LIMIT : BODY_LIMIT
            } limit.`,
          ),
        );
        return;
      case 'charset.unsupported':
      case 'encoding.unsupported':
        next(problems.unsupportedMediaType());
        return;
      default:
        break;
    }
  }
  next(error);
}
