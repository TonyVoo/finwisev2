import {
  ExpenseCreateRequest,
  ExpenseListQuery,
  ExpenseListResponse,
  ExpenseResponse,
  ExpenseUpdateRequest,
  ReceiptIndexResponse,
  ReceiptPutRequest,
  ReceiptResponse,
  ReceiptScanRequest,
  ReceiptScanResponse,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { ResourceIdParams } from '../http/params.ts';
import { sendJson } from '../http/respond.ts';
import { dataOwnerIdOf, userIdOf } from '../http/types.ts';
import {
  validateBody,
  validateParams,
  validateQuery,
  validatedParams,
  validatedQuery,
} from '../middleware/validate.ts';
import { deleteReceipt, getReceipt, listReceipts, putReceipt } from '../services/receiptService.ts';
import { scanReceipt } from '../services/receiptScanService.ts';
import { receiptScanRateLimit } from '../middleware/receiptScanRateLimit.ts';
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
    const page = await listExpenses(getPrisma(), dataOwnerIdOf(req), query, userIdOf(req));
    sendJson(res, 200, ExpenseListResponse, page);
  },
);

expensesRouter.post(
  '/expenses',
  validateBody(ExpenseCreateRequest),
  async (req: Request, res: Response) => {
    const body = req.body as ExpenseCreateRequest;
    const data = await createExpense(getPrisma(), dataOwnerIdOf(req), body, userIdOf(req));
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
    const data = await updateExpense(getPrisma(), dataOwnerIdOf(req), id, body, userIdOf(req));
    sendJson(res, 200, ExpenseResponse, { data });
  },
);

expensesRouter.delete(
  '/expenses/:id',
  validateParams(ResourceIdParams),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    const data = await deleteExpense(getPrisma(), dataOwnerIdOf(req), id, userIdOf(req));
    sendJson(res, 200, ExpenseResponse, { data });
  },
);

expensesRouter.put(
  '/expenses/:id/receipt',
  validateParams(ResourceIdParams),
  validateBody(ReceiptPutRequest),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    const body = req.body as ReceiptPutRequest;
    const data = await putReceipt(
      getPrisma(),
      dataOwnerIdOf(req),
      id,
      body.dataBase64,
      userIdOf(req),
    );
    sendJson(res, 200, ReceiptResponse, { data });
  },
);

expensesRouter.get(
  '/expenses/:id/receipt',
  validateParams(ResourceIdParams),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    const data = await getReceipt(getPrisma(), dataOwnerIdOf(req), id, userIdOf(req));
    sendJson(res, 200, ReceiptResponse, { data });
  },
);

expensesRouter.delete(
  '/expenses/:id/receipt',
  validateParams(ResourceIdParams),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    await deleteReceipt(getPrisma(), dataOwnerIdOf(req), id, userIdOf(req));
    res.status(204).end();
  },
);

expensesRouter.get('/receipts', async (req: Request, res: Response) => {
  const data = await listReceipts(getPrisma(), dataOwnerIdOf(req), userIdOf(req));
  sendJson(res, 200, ReceiptIndexResponse, { data });
});

/**
 * `POST /receipts/scan`: read a photo and suggest values. Throttled before anything else, and
 * tied to no expense: the image is read and dropped, not stored.
 */
expensesRouter.post(
  '/receipts/scan',
  receiptScanRateLimit,
  validateBody(ReceiptScanRequest),
  async (req: Request, res: Response) => {
    const body = req.body as ReceiptScanRequest;
    const data = await scanReceipt(getPrisma(), userIdOf(req), body.dataBase64);
    sendJson(res, 200, ReceiptScanResponse, { data });
  },
);
