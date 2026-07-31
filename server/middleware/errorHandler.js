import { redact } from '../utils/redact.js';

/**
 * Normalizes every failure onto the standard error envelope.
 * Only messages explicitly marked safe (`expose`) or client-class statuses are
 * returned; anything else becomes a generic internal error.
 */
export function createErrorHandler({ logger } = {}) {
  return function errorHandler(error, req, res, next) {
    if (res.headersSent) {
      return next(error);
    }

    const invalidJson = error?.type === 'entity.parse.failed';
    const payloadTooLarge = error?.type === 'entity.too.large';

    const status = invalidJson ? 400 : payloadTooLarge ? 413 : error?.status ?? 500;
    const code = invalidJson
      ? 'INVALID_JSON'
      : payloadTooLarge
        ? 'VALIDATION_ERROR'
        : error?.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
    const message = invalidJson
      ? 'Request body contains invalid JSON'
      : payloadTooLarge
        ? 'Request body is too large'
        : error?.expose === true || status < 500
          ? error?.message
          : 'Internal server error';

    if (status >= 500) {
      logger?.error('request.failed', {
        code,
        method: req.method,
        path: req.originalUrl,
        requestId: res.locals.requestId,
        reason: error?.message
      });
    }

    const body = {
      success: false,
      error: { code, message },
      requestId: res.locals.requestId
    };

    if (error?.details !== undefined) {
      body.error.details = redact(error.details);
    }

    return res.status(status).json(body);
  };
}

export const errorHandler = createErrorHandler();
