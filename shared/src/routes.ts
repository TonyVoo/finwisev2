/**
 * The API surface, declared once.
 *
 * `docs/api/openapi.yaml` is the human-readable source of truth; this table is the
 * machine-readable mirror of it. A test in this package asserts the two agree exactly,
 * so a route added to one and forgotten in the other fails the build rather than
 * surfacing as a 404 on a device.
 */

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface RouteSpec {
  readonly method: HttpMethod;
  /** OpenAPI-style path template, including the `/v1` prefix. */
  readonly path: string;
  /** `operationId` in `openapi.yaml`. */
  readonly operationId: string;
  /** Whether a valid `Authorization: Bearer <accessToken>` is required. */
  readonly auth: boolean;
  /** Status code of the success response. */
  readonly successStatus: number;
}

export const API_ROUTES = [
  { method: 'get', path: '/v1/health', operationId: 'getHealth', auth: false, successStatus: 200 },

  {
    method: 'post',
    path: '/v1/auth/signup',
    operationId: 'signup',
    auth: false,
    successStatus: 201,
  },
  { method: 'post', path: '/v1/auth/login', operationId: 'login', auth: false, successStatus: 200 },
  {
    method: 'post',
    path: '/v1/auth/refresh',
    operationId: 'refresh',
    auth: false,
    successStatus: 200,
  },
  {
    method: 'post',
    path: '/v1/auth/logout',
    operationId: 'logout',
    auth: false,
    successStatus: 204,
  },
  {
    method: 'post',
    path: '/v1/auth/forgot-password',
    operationId: 'forgotPassword',
    auth: false,
    successStatus: 204,
  },
  {
    method: 'post',
    path: '/v1/auth/reset-password',
    operationId: 'resetPassword',
    auth: false,
    successStatus: 204,
  },
  { method: 'get', path: '/v1/me', operationId: 'getMe', auth: true, successStatus: 200 },
  {
    method: 'delete',
    path: '/v1/me',
    operationId: 'deleteAccount',
    auth: true,
    successStatus: 204,
  },
  {
    method: 'post',
    path: '/v1/me/password',
    operationId: 'changePassword',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'post',
    path: '/v1/me/email-verification',
    operationId: 'requestEmailVerification',
    auth: true,
    successStatus: 204,
  },
  {
    method: 'post',
    path: '/v1/me/email-verification/confirm',
    operationId: 'confirmEmailVerification',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'patch',
    path: '/v1/me/email',
    operationId: 'changeEmail',
    auth: true,
    successStatus: 200,
  },

  {
    method: 'get',
    path: '/v1/household',
    operationId: 'getHousehold',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'post',
    path: '/v1/household',
    operationId: 'createHousehold',
    auth: true,
    successStatus: 201,
  },
  {
    method: 'delete',
    path: '/v1/household',
    operationId: 'deleteHousehold',
    auth: true,
    successStatus: 204,
  },
  {
    method: 'post',
    path: '/v1/household/invite',
    operationId: 'createHouseholdInvite',
    auth: true,
    successStatus: 201,
  },
  {
    method: 'post',
    path: '/v1/household/join',
    operationId: 'joinHousehold',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'post',
    path: '/v1/household/leave',
    operationId: 'leaveHousehold',
    auth: true,
    successStatus: 204,
  },
  {
    method: 'post',
    path: '/v1/household/transfer',
    operationId: 'transferHousehold',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'delete',
    path: '/v1/household/members/{memberId}',
    operationId: 'removeHouseholdMember',
    auth: true,
    successStatus: 204,
  },

  {
    method: 'get',
    path: '/v1/categories',
    operationId: 'listCategories',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'post',
    path: '/v1/categories',
    operationId: 'createCategory',
    auth: true,
    successStatus: 201,
  },
  {
    method: 'patch',
    path: '/v1/categories/{id}',
    operationId: 'updateCategory',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'delete',
    path: '/v1/categories/{id}',
    operationId: 'deleteCategory',
    auth: true,
    successStatus: 200,
  },

  {
    method: 'get',
    path: '/v1/expenses',
    operationId: 'listExpenses',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'post',
    path: '/v1/expenses',
    operationId: 'createExpense',
    auth: true,
    successStatus: 201,
  },
  {
    method: 'patch',
    path: '/v1/expenses/{id}',
    operationId: 'updateExpense',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'delete',
    path: '/v1/expenses/{id}',
    operationId: 'deleteExpense',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'put',
    path: '/v1/expenses/{id}/receipt',
    operationId: 'putReceipt',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'get',
    path: '/v1/expenses/{id}/receipt',
    operationId: 'getReceipt',
    auth: true,
    successStatus: 200,
  },
  {
    method: 'delete',
    path: '/v1/expenses/{id}/receipt',
    operationId: 'deleteReceipt',
    auth: true,
    successStatus: 204,
  },
  {
    method: 'get',
    path: '/v1/receipts',
    operationId: 'listReceipts',
    auth: true,
    successStatus: 200,
  },

  { method: 'get', path: '/v1/rates', operationId: 'getRate', auth: true, successStatus: 200 },

  { method: 'get', path: '/v1/sync', operationId: 'pullSync', auth: true, successStatus: 200 },
  { method: 'post', path: '/v1/sync', operationId: 'pushSync', auth: true, successStatus: 200 },
] as const satisfies ReadonlyArray<RouteSpec>;

export type ApiRoute = (typeof API_ROUTES)[number];
export type ApiOperationId = ApiRoute['operationId'];

/** `"get /v1/health"` style key, used by the contract-parity test. */
export function routeKey(route: Pick<RouteSpec, 'method' | 'path'>): string {
  return `${route.method} ${route.path}`;
}
