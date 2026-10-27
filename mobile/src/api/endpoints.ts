import {
  API_ROUTES,
  type ApiOperationId,
  AuthResponse,
  CategoryListResponse,
  CategoryResponse,
  ExpenseListResponse,
  ExpenseResponse,
  HealthResponse,
  HouseholdInviteResponse,
  HouseholdResponse,
  RatesResponse,
  ReceiptIndexResponse,
  ReceiptResponse,
  MeResponse,
  RefreshResponse,
  type RouteSpec,
  SyncPullResponse,
  SyncPushResponse,
  TokenPair,
} from '@expense-tracker/shared';
import type { z } from 'zod';

/**
 * Every endpoint, bound to the schema that validates its response.
 *
 * The method, path and auth requirement come from `API_ROUTES`; the response shapes come
 * from the zod schemas. Nothing about the wire format is written down here - this module
 * only records which route answers with which schema. That is the anti-drift property
 * `docs/PLAN.md` §2 asks for: there is no hand-written wire type on the client, so a
 * contract change cannot be accommodated by quietly editing a mobile interface.
 *
 * `tests/api/endpoints.test.ts` asserts the table covers `API_ROUTES` exactly, so a route
 * added to the contract fails the build here instead of 404-ing on a device.
 */

export interface Endpoint<Response> {
  readonly route: RouteSpec;
  /** Null for a route whose success response has no body (204). */
  readonly responseSchema: z.ZodType<Response> | null;
}

function routeFor(operationId: ApiOperationId): RouteSpec {
  const route = API_ROUTES.find((candidate) => candidate.operationId === operationId);
  if (route === undefined) {
    // Unreachable while `operationId` is typed from `API_ROUTES`; this is here so that a
    // future loosening of that type fails loudly rather than silently building a
    // request to `undefined`.
    throw new Error(`No route declared for operation ${operationId}`);
  }
  return route;
}

function endpoint<Response>(
  operationId: ApiOperationId,
  responseSchema: z.ZodType<Response>,
): Endpoint<Response> {
  return { route: routeFor(operationId), responseSchema };
}

function emptyEndpoint(operationId: ApiOperationId): Endpoint<void> {
  return { route: routeFor(operationId), responseSchema: null };
}

export const ENDPOINTS = {
  getHealth: endpoint('getHealth', HealthResponse),

  signup: endpoint('signup', AuthResponse),
  login: endpoint('login', AuthResponse),
  refresh: endpoint('refresh', RefreshResponse),
  logout: emptyEndpoint('logout'),
  forgotPassword: emptyEndpoint('forgotPassword'),
  resetPassword: emptyEndpoint('resetPassword'),
  getMe: endpoint('getMe', MeResponse),
  changePassword: endpoint('changePassword', TokenPair),
  changeEmail: endpoint('changeEmail', MeResponse),
  requestEmailVerification: emptyEndpoint('requestEmailVerification'),
  confirmEmailVerification: endpoint('confirmEmailVerification', MeResponse),
  deleteAccount: emptyEndpoint('deleteAccount'),

  getHousehold: endpoint('getHousehold', HouseholdResponse),
  createHousehold: endpoint('createHousehold', HouseholdResponse),
  deleteHousehold: emptyEndpoint('deleteHousehold'),
  createHouseholdInvite: endpoint('createHouseholdInvite', HouseholdInviteResponse),
  joinHousehold: endpoint('joinHousehold', HouseholdResponse),
  leaveHousehold: emptyEndpoint('leaveHousehold'),
  transferHousehold: endpoint('transferHousehold', HouseholdResponse),
  removeHouseholdMember: emptyEndpoint('removeHouseholdMember'),

  putReceipt: endpoint('putReceipt', ReceiptResponse),
  getReceipt: endpoint('getReceipt', ReceiptResponse),
  deleteReceipt: emptyEndpoint('deleteReceipt'),
  listReceipts: endpoint('listReceipts', ReceiptIndexResponse),

  listCategories: endpoint('listCategories', CategoryListResponse),
  createCategory: endpoint('createCategory', CategoryResponse),
  updateCategory: endpoint('updateCategory', CategoryResponse),
  deleteCategory: endpoint('deleteCategory', CategoryResponse),

  listExpenses: endpoint('listExpenses', ExpenseListResponse),
  createExpense: endpoint('createExpense', ExpenseResponse),
  updateExpense: endpoint('updateExpense', ExpenseResponse),
  deleteExpense: endpoint('deleteExpense', ExpenseResponse),

  getRate: endpoint('getRate', RatesResponse),
  pullSync: endpoint('pullSync', SyncPullResponse),
  pushSync: endpoint('pushSync', SyncPushResponse),
} as const satisfies Readonly<Record<ApiOperationId, Endpoint<unknown>>>;
