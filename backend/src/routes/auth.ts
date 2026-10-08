import {
  AuthResponse,
  DEFAULT_CURRENCY,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
  RefreshResponse,
  SignupRequest,
} from '@expense-tracker/shared';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../db/client.ts';
import { sendJson } from '../http/respond.ts';
import { validateBody } from '../middleware/validate.ts';
import { login, logout, refresh, signup } from '../services/authService.ts';

/**
 * `/v1/auth/*` — the unauthenticated endpoints.
 *
 * These four are the only routes that take credentials, and they are deliberately thin:
 * validate with the `shared/` schema, call the service, send the `shared/` response
 * shape. Every decision worth arguing about (email normalisation, the indistinguishable
 * credential failures, refresh rotation) lives in `services/authService.ts` where it can
 * be read in one place.
 */
export const authRouter = Router();

authRouter.post(
  '/auth/signup',
  validateBody(SignupRequest),
  async (req: Request, res: Response) => {
    const body = req.body as SignupRequest;
    const result = await signup(getPrisma(), {
      email: body.email,
      password: body.password,
      // The contract makes `currency` optional and documents the default; applying it
      // here rather than in the schema keeps `SignupRequest` an honest description of
      // what the client sent.
      currency: body.currency ?? DEFAULT_CURRENCY,
    });
    sendJson(res, 201, AuthResponse, result);
  },
);

authRouter.post('/auth/login', validateBody(LoginRequest), async (req: Request, res: Response) => {
  const body = req.body as LoginRequest;
  const result = await login(getPrisma(), { email: body.email, password: body.password });
  sendJson(res, 200, AuthResponse, result);
});

authRouter.post(
  '/auth/refresh',
  validateBody(RefreshRequest),
  async (req: Request, res: Response) => {
    const body = req.body as RefreshRequest;
    const tokens = await refresh(getPrisma(), body.refreshToken);
    sendJson(res, 200, RefreshResponse, tokens);
  },
);

authRouter.post(
  '/auth/logout',
  validateBody(LogoutRequest),
  async (req: Request, res: Response) => {
    const body = req.body as LogoutRequest;
    await logout(getPrisma(), body.refreshToken);
    // 204, per the contract, whether or not the token was valid: the client's goal is
    // "this session is over so I can clear local credentials", and an error would leave
    // the app stuck half-logged-out with no way forward.
    res.status(204).end();
  },
);
