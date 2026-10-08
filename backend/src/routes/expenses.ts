import {
  ExpenseCreateRequest,
  ExpenseListQuery,
  ExpenseListResponse,
  ExpenseResponse,
  ExpenseUpdateRequest,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { ResourceIdParams } from '../http/params.ts';
import { sendJson } from '../http/respond.ts';
import { userIdOf } from '../http/types.ts';
import {
  validateBody,
  validateParams,
  validateQuery,
  validatedParams,
  validatedQuery,
} from '../middleware/validate.ts';
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
} from '../services/expenseService.ts';

/**
 * `/v1/expenses` — the thin REST surface over expenses.
 *
 * The mobile app does not read its list or its monthly totals from here; it reads local
 * SQLite, which is what makes those work offline. This exists for a thin/online client,
 * and so QA has a way to assert server state directly.
 */
export const expensesRouter = Router();

expensesRouter.get(
  '/expenses',
  validateQuery(ExpenseListQuery),
  async (req: Request, res: Response) => {
    const query = validatedQuery(res, ExpenseListQuery);
    const page = await listExpenses(getPrisma(), userIdOf(req), query);
    sendJson(res, 200, ExpenseListResponse, page);
  },
);

expensesRouter.post(
  '/expenses',
  validateBody(ExpenseCreateRequest),
  async (req: Request, res: Response) => {
    const body = req.body as ExpenseCreateRequest;
    const data = await createExpense(getPrisma(), userIdOf(req), body);
    sendJson(res, 201, ExpenseResponse, { data });
  },
);

expensesRouter.patch(
  '/expenses/:id',
  validateParams(ResourceIdParams),
  validateBody(ExpenseUpdateRequest),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    const body = req.body as ExpenseUpdateRequest;
    const data = await updateExpense(getPrisma(), userIdOf(req), id, body);
    sendJson(res, 200, ExpenseResponse, { data });
  },
);

expensesRouter.delete(
  '/expenses/:id',
  validateParams(ResourceIdParams),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    const data = await deleteExpense(getPrisma(), userIdOf(req), id);
    sendJson(res, 200, ExpenseResponse, { data });
  },
);
