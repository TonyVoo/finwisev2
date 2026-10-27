import type {
  AuthResponse,
  CategoryCreateRequest,
  CategoryListQuery,
  CategoryListResponse,
  CategoryResponse,
  CategoryUpdateRequest,
  ChangeEmailRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ChangePasswordRequest,
  DeleteAccountRequest,
  ExpenseCreateRequest,
  ExpenseListQuery,
  ExpenseListResponse,
  ExpenseResponse,
  ExpenseUpdateRequest,
  HealthResponse,
  LoginRequest,
  LogoutRequest,
  MeResponse,
  RefreshRequest,
  RefreshResponse,
  SignupRequest,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TokenPair,
} from '@expense-tracker/shared';
import { ENDPOINTS, type Endpoint } from './endpoints';
import { ResponseShapeError, toApiRequestError } from './errors';
import type { QueryValue, Transport } from './transport';

/**
 * The typed API client.
 *
 * Every argument type and every return type on this surface is imported from
 * `@expense-tracker/shared`, where it is inferred from the zod schema the backend
 * validates with. There is not one hand-written wire type in this file, which is what
 * makes a contract change a compile error here rather than a runtime surprise on a
 * device.
 *
 * Responses are also parsed at runtime, not just typed. The schemas are strict, so a
 * field the contract does not describe is a loud failure instead of `undefined`
 * spreading through the app. Both sides ship from the same `shared/` version, so there
 * is no older-client case to stay permissive for.
 */

export interface ApiClient {
  getHealth(): Promise<HealthResponse>;

  signup(body: SignupRequest): Promise<AuthResponse>;
  login(body: LoginRequest): Promise<AuthResponse>;
  refresh(body: RefreshRequest): Promise<RefreshResponse>;
  logout(body: LogoutRequest): Promise<void>;
  /** Emails a reset code. 204 whether or not the account exists. */
  forgotPassword(body: ForgotPasswordRequest): Promise<void>;
  /** Sets a new password from the emailed code and ends every session. 204, no body. */
  resetPassword(body: ResetPasswordRequest): Promise<void>;
  getMe(): Promise<MeResponse>;
  /** Replaces the password and ends every other session; returns this device's new pair. */
  changePassword(body: ChangePasswordRequest): Promise<TokenPair>;
  /** Replaces the sign-in email (password re-entered); returns the updated user. */
  changeEmail(body: ChangeEmailRequest): Promise<MeResponse>;
  /** Permanently deletes the account and all its data. 204, no body. */
  deleteAccount(body: DeleteAccountRequest): Promise<void>;

  listCategories(query?: CategoryListQuery): Promise<CategoryListResponse>;
  createCategory(body: CategoryCreateRequest): Promise<CategoryResponse>;
  updateCategory(id: string, body: CategoryUpdateRequest): Promise<CategoryResponse>;
  deleteCategory(id: string): Promise<CategoryResponse>;

  listExpenses(query?: ExpenseListQuery): Promise<ExpenseListResponse>;
  createExpense(body: ExpenseCreateRequest): Promise<ExpenseResponse>;
  updateExpense(id: string, body: ExpenseUpdateRequest): Promise<ExpenseResponse>;
  deleteExpense(id: string): Promise<ExpenseResponse>;

  /** Pull changes with `revision > since`. The cursor is a revision, never a timestamp. */
  pullSync(query?: SyncPullQuery): Promise<SyncPullResponse>;
  /** Push a batch. Results are per record, so one bad row cannot fail the batch. */
  pushSync(body: SyncPushRequest): Promise<SyncPushResponse>;
}

export interface ApiClientOptions {
  /** Usually the authorized transport; the refresh call uses the raw one. */
  readonly transport: Transport;
  readonly signal?: AbortSignal;
}

interface SendInit {
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, QueryValue>> | undefined;
  readonly body?: unknown;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { transport, signal } = options;

  async function send<Response>(
    endpoint: Endpoint<Response>,
    init: SendInit = {},
  ): Promise<Response> {
    const response = await transport({
      method: endpoint.route.method,
      path: resolvePath(endpoint.route.path, init.pathParams),
      query: init.query,
      body: init.body,
      requiresAuth: endpoint.route.auth,
      signal,
    });

    if (response.status >= 400) {
      throw toApiRequestError(response.status, response.body, response.requestId);
    }

    if (endpoint.responseSchema === null) {
      return undefined as Response;
    }

    const parsed = endpoint.responseSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new ResponseShapeError(
        response.status,
        parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
        parsed.error,
      );
    }
    return parsed.data;
  }

  return {
    getHealth: () => send(ENDPOINTS.getHealth),

    signup: (body) => send(ENDPOINTS.signup, { body }),
    login: (body) => send(ENDPOINTS.login, { body }),
    refresh: (body) => send(ENDPOINTS.refresh, { body }),
    logout: (body) => send(ENDPOINTS.logout, { body }),
    forgotPassword: (body) => send(ENDPOINTS.forgotPassword, { body }),
    resetPassword: (body) => send(ENDPOINTS.resetPassword, { body }),
    getMe: () => send(ENDPOINTS.getMe),
    changePassword: (body) => send(ENDPOINTS.changePassword, { body }),
    changeEmail: (body) => send(ENDPOINTS.changeEmail, { body }),
    deleteAccount: (body) => send(ENDPOINTS.deleteAccount, { body }),

    listCategories: (query) => send(ENDPOINTS.listCategories, { query: toQuery(query) }),
    createCategory: (body) => send(ENDPOINTS.createCategory, { body }),
    updateCategory: (id, body) => send(ENDPOINTS.updateCategory, { pathParams: { id }, body }),
    deleteCategory: (id) => send(ENDPOINTS.deleteCategory, { pathParams: { id } }),

    listExpenses: (query) => send(ENDPOINTS.listExpenses, { query: toQuery(query) }),
    createExpense: (body) => send(ENDPOINTS.createExpense, { body }),
    updateExpense: (id, body) => send(ENDPOINTS.updateExpense, { pathParams: { id }, body }),
    deleteExpense: (id) => send(ENDPOINTS.deleteExpense, { pathParams: { id } }),

    pullSync: (query) => send(ENDPOINTS.pullSync, { query: toQuery(query) }),
    pushSync: (body) => send(ENDPOINTS.pushSync, { body }),
  };
}

/**
 * Substitute `{id}` style placeholders in a route template.
 *
 * Throws on a placeholder with no value rather than sending the literal `{id}`, which
 * would read as a 404 from a route that exists.
 */
export function resolvePath(
  template: string,
  pathParams: Readonly<Record<string, string>> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = pathParams[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter ${name} for ${template}`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * The query schemas infer to objects of optional primitives, which is exactly what the
 * transport serialises. This cast documents that rather than hiding it; the shapes are
 * checked by the shared schemas at both ends.
 */
function toQuery(query: object | undefined): Readonly<Record<string, QueryValue>> | undefined {
  return query as Readonly<Record<string, QueryValue>> | undefined;
}
