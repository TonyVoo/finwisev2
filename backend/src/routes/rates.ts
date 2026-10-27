import { RatesQuery, RatesResponse } from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { sendJson } from '../http/respond.ts';
import { validateQuery, validatedQuery } from '../middleware/validate.ts';
import { getExchangeRate } from '../services/ratesService.ts';

/**
 * `GET /v1/rates` - what to multiply a foreign amount by.
 *
 * Authenticated like everything else under `/v1`: it spends the server's outbound budget on
 * the provider, so it is not a public relay. Answers a decimal string and writes nothing.
 */
export const ratesRouter = Router();

ratesRouter.get('/rates', validateQuery(RatesQuery), async (_req: Request, res: Response) => {
  const query = validatedQuery(res, RatesQuery);
  const data = await getExchangeRate(query);
  sendJson(res, 200, RatesResponse, { data });
});
