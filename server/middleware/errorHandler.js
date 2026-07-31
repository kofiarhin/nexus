export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const invalidJson = error?.type === 'entity.parse.failed';
  const status = invalidJson ? 400 : error.status ?? 500;
  const code = invalidJson
    ? 'INVALID_JSON'
    : error.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const message = invalidJson
    ? 'Request body contains invalid JSON'
    : error.expose === true || status < 500
      ? error.message
      : 'Internal server error';

  return res.status(status).json({
    success: false,
    error: {
      code,
      message
    },
    requestId: res.locals.requestId
  });
}
