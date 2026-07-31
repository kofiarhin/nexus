import { appError } from '../utils/errors.js';

export const SESSION_COOKIE = 'nexus_session';
export const CSRF_COOKIE = 'nexus_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Resolves the principal for every request without rejecting anonymous ones. */
export function attachPrincipal({ authService }) {
  return (req, res, next) => {
    const token = req.cookies?.[SESSION_COOKIE] ?? null;
    res.locals.principal = authService.resolvePrincipal(token);
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!res.locals.principal) {
    return next(appError('AUTH_REQUIRED', 'Authentication is required'));
  }
  return next();
}

/** Owner-only authorization. Multi-user roles need a separate approved model. */
export function requireOwner(req, res, next) {
  const principal = res.locals.principal;
  if (!principal) {
    return next(appError('AUTH_REQUIRED', 'Authentication is required'));
  }
  if (principal.role !== 'owner') {
    return next(appError('FORBIDDEN', 'This action is restricted to the owner'));
  }
  return next();
}

export function setSessionCookie(res, { token, maxAgeMs, secure }) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: maxAgeMs
  });
}

/**
 * Double-submit CSRF token. The value is readable by the client so it can be
 * echoed in a header; the session cookie itself stays httpOnly.
 */
export function setCsrfCookie(res, { token, maxAgeMs, secure }) {
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: maxAgeMs
  });
}

export function clearAuthCookies(res, { secure }) {
  const options = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
  res.clearCookie(SESSION_COOKIE, options);
  res.clearCookie(CSRF_COOKIE, { ...options, httpOnly: false });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check.
 *
 * It applies only to requests that actually carry a session cookie: a
 * cross-site request is dangerous precisely because the browser attaches that
 * cookie. Sign-in has no session to ride on yet, and every other unauthenticated
 * request is refused by the auth guard regardless.
 */
export function csrfProtection({ env }) {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!env.authEnabled) return next();
    if (!req.cookies?.[SESSION_COOKIE]) return next();

    const cookieToken = req.cookies?.[CSRF_COOKIE];
    const headerToken = req.get(CSRF_HEADER);

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return next(appError('CSRF_TOKEN_INVALID', 'A valid CSRF token is required for this request'));
    }

    return next();
  };
}
