import { z } from 'zod';
import { LIMITS } from './primitives.js';

/**
 * `POST /v1/recap`: reword a month's insight sentences into a short recap
 * (`docs/design/16-monthly-insights.md`). The phone has already worked the figures out and worded each as a
 * sentence for the Insights card; this only asks for them to be said as a few friendly sentences. Nothing is
 * stored and no expense is involved: the model never sees an expense, only the facts the card shows.
 */

export const RecapRequest = z.strictObject({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'must be a month as YYYY-MM' })
    .describe('The month the facts are about, as YYYY-MM.'),
  language: z.enum(['en', 'vi']).describe("The app's language, which the recap is written in."),
  facts: z
    .array(
      z
        .string()
        .min(1)
        .max(LIMITS.RECAP_FACT_MAX)
        .regex(/\S/, { error: 'must contain something other than spaces' }),
    )
    .min(1)
    .max(LIMITS.RECAP_MAX_FACTS)
    .describe(
      'The insight sentences the Insights card shows, at most 12 of at most 200 characters. Any category names and amounts in them are sent as written.',
    ),
});

export const RecapText = z.strictObject({
  text: z
    .string()
    .min(1)
    .max(LIMITS.RECAP_TEXT_MAX)
    .describe('Two or three short sentences using only numbers from the facts.'),
});

export const RecapResponse = z.strictObject({ data: RecapText });

export type RecapRequest = z.infer<typeof RecapRequest>;
export type RecapText = z.infer<typeof RecapText>;
export type RecapResponse = z.infer<typeof RecapResponse>;
