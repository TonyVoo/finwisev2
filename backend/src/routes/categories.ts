import {
  CategoryCreateRequest,
  CategoryListQuery,
  CategoryListResponse,
  CategoryResponse,
  CategoryUpdateRequest,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { ResourceIdParams } from '../http/params.ts';
import { sendJson } from '../http/respond.ts';
import { dataOwnerIdOf } from '../http/types.ts';
import {
  validateBody,
  validateParams,
  validateQuery,
  validatedParams,
  validatedQuery,
} from '../middleware/validate.ts';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../services/categoryService.ts';

/**
 * `/v1/categories` — the thin REST surface over categories.
 *
 * Mounted on the authenticated router, so `requireAuth` has already run and `dataOwnerIdOf`
 * is the only source of tenancy. The handlers stay thin on purpose: validate with the
 * `shared/` schema, call the service, send the `shared/` response shape. The decisions
 * worth arguing about — name uniqueness, the undeletable default, the reassignment on
 * delete — live in `services/categoryService.ts`, in one readable place.
 */
export const categoriesRouter = Router();

categoriesRouter.get(
  '/categories',
  validateQuery(CategoryListQuery),
  async (req: Request, res: Response) => {
    const query = validatedQuery(res, CategoryListQuery);
    const data = await listCategories(getPrisma(), dataOwnerIdOf(req), {
      includeDeleted: query.includeDeleted,
    });
    sendJson(res, 200, CategoryListResponse, { data });
  },
);

categoriesRouter.post(
  '/categories',
  validateBody(CategoryCreateRequest),
  async (req: Request, res: Response) => {
    const body = req.body as CategoryCreateRequest;
    const data = await createCategory(getPrisma(), dataOwnerIdOf(req), body);
    // `201` even for an idempotent replay of an id already stored: the contract declares
    // exactly one success status for this operation, and a retried create whose first
    // response was lost should look to the client exactly like the one it missed.
    sendJson(res, 201, CategoryResponse, { data });
  },
);

categoriesRouter.patch(
  '/categories/:id',
  validateParams(ResourceIdParams),
  validateBody(CategoryUpdateRequest),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    const body = req.body as CategoryUpdateRequest;
    const data = await updateCategory(getPrisma(), dataOwnerIdOf(req), id, body);
    sendJson(res, 200, CategoryResponse, { data });
  },
);

categoriesRouter.delete(
  '/categories/:id',
  validateParams(ResourceIdParams),
  async (req: Request, res: Response) => {
    const { id } = validatedParams(res, ResourceIdParams);
    const data = await deleteCategory(getPrisma(), dataOwnerIdOf(req), id);
    // `200` with the tombstoned row rather than `204`: the client stores the tombstone
    // directly, and a delete it cannot see the result of is a delete it has to re-pull.
    sendJson(res, 200, CategoryResponse, { data });
  },
);
