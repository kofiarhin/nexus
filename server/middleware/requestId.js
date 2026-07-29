import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  res.locals.requestId = req.get('x-request-id') || randomUUID();
  res.set('x-request-id', res.locals.requestId);
  next();
}
