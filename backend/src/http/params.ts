import { Uuid } from '@expense-tracker/shared';
import { z } from 'zod';

/**
 * The `{id}` path parameter, shared by every `/:id` route.
 *
 * Declared once so that a value which is not an id at all is consistently
 * `400 validation_error` — a client that sent `abc` where a UUID belongs made a request
 * error, and telling it `404` instead would send it looking for a missing row.
 */
export const ResourceIdParams = z.strictObject({ id: Uuid });
export type ResourceIdParams = z.infer<typeof ResourceIdParams>;
