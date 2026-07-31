/** Forwards rejected promises to the error middleware. */
export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

/** Per-request context every mutation controller needs. */
export const requestContext = (res, req) => ({
  actor: res.locals.principal,
  requestId: res.locals.requestId,
  idempotencyKey: req.get('idempotency-key') || null
});
