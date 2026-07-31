/**
 * Canonical error codes from docs/SPECIFICATION.md section 19.
 * Every operational failure normalizes onto one of these so responses stay
 * predictable and never leak upstream payloads.
 */
export const ERROR_CODES = {
  AUTH_REQUIRED: 401,
  AUTH_NOT_CONFIGURED: 503,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  PATH_NOT_ALLOWED: 403,
  OPERATION_NOT_ALLOWED: 403,
  APPROVAL_REQUIRED: 409,
  DESTRUCTIVE_CONFIRMATION_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VAULT_NOT_CONFIGURED: 503,
  VAULT_FILE_NOT_FOUND: 404,
  VAULT_FILE_EXISTS: 409,
  VAULT_CONFLICT: 409,
  VAULT_UPSTREAM_ERROR: 502,
  VAULT_WRITE_DISABLED: 503,
  AI_NOT_CONFIGURED: 503,
  AI_UPSTREAM_ERROR: 502,
  AI_TIMEOUT: 504,
  CONTEXT_LIMIT_EXCEEDED: 413,
  RATE_LIMITED: 429,
  CSRF_TOKEN_INVALID: 403,
  INVALID_JSON: 400,
  CONFLICT: 409,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500
};

export class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code] ?? 500;
    // `expose` marks the message as reviewed and safe to return to a client.
    this.expose = true;
    if (details !== undefined) this.details = details;
  }
}

export function appError(code, message, details) {
  return new AppError(code, message, details);
}

export const isAppError = (error) => error instanceof AppError;
