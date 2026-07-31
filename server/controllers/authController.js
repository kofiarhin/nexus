import { randomBytes } from 'node:crypto';
import {
  clearAuthCookies,
  setCsrfCookie,
  setSessionCookie
} from '../middleware/auth.js';
import { appError } from '../utils/errors.js';
import { ok } from '../utils/respond.js';
import { asyncHandler } from './helpers.js';

export function createAuthController({ authService, env, logger }) {
  return {
    login: asyncHandler((req, res) => {
      const { email, password } = res.locals.body;
      const session = authService.login({ email, password });

      setSessionCookie(res, { token: session.token, maxAgeMs: session.maxAgeMs, secure: env.cookieSecure });
      setCsrfCookie(res, {
        token: randomBytes(24).toString('base64url'),
        maxAgeMs: session.maxAgeMs,
        secure: env.cookieSecure
      });

      logger?.info('auth.login', { requestId: res.locals.requestId, outcome: 'succeeded' });

      return ok(res, {
        principal: session.principal,
        expiresAt: session.expiresAt
      });
    }),

    session(req, res) {
      const principal = res.locals.principal;
      if (!principal) {
        throw appError('AUTH_REQUIRED', 'No active session');
      }
      return ok(res, { principal, ...authService.status() });
    },

    /** Public: lets the sign-in screen explain an unconfigured owner. */
    status(req, res) {
      return ok(res, {
        ...authService.status(),
        authenticated: Boolean(res.locals.principal),
        writeOperationsEnabled: env.writeOperationsEnabled,
        destructiveOperationsEnabled: env.destructiveOperationsEnabled
      });
    },

    logout(req, res) {
      clearAuthCookies(res, { secure: env.cookieSecure });
      logger?.info('auth.logout', { requestId: res.locals.requestId });
      return ok(res, { loggedOut: true });
    }
  };
}
