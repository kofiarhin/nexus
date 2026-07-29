export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status ?? 500;
  return res.status(status).json({
    success: false,
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: status >= 500 ? 'Internal server error' : error.message
    },
    requestId: res.locals.requestId
  });
}
