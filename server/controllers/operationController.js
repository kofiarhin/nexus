import { appError } from '../utils/errors.js';
import { ok, created } from '../utils/respond.js';
import { asyncHandler, requestContext } from './helpers.js';

export function createOperationController({ operationService, auditService }) {
  return {
    list: asyncHandler(async (req, res) => {
      return ok(res, { operations: operationService.list({ limit: 50, status: req.query.status ?? null }) });
    }),

    propose: asyncHandler(async (req, res) => {
      const body = res.locals.body;
      const operation = await operationService.propose({
        ...requestContext(res, req),
        action: body.action,
        path: body.path,
        destinationPath: body.destinationPath ?? null,
        content: body.content ?? null,
        expectedSha: body.expectedSha ?? body.revision ?? null,
        restoreRevision: body.revision ?? null,
        underHeading: body.underHeading ?? null,
        reason: body.reason,
        message: body.message,
        sources: body.sources,
        conversationId: body.conversationId ?? null,
        source: 'manual'
      });
      return created(res, { operation });
    }),

    get: asyncHandler(async (req, res) => {
      const operation = operationService.get(req.params.operationId);
      if (!operation) throw appError('NOT_FOUND', 'Operation not found');
      return ok(res, {
        operation,
        audit: auditService.list({ operationId: operation.id, limit: 50 })
      });
    }),

    approve: asyncHandler(async (req, res) => {
      const context = requestContext(res, req);
      return ok(res, {
        operation: operationService.approve({ operationId: req.params.operationId, ...context })
      });
    }),

    reject: asyncHandler(async (req, res) => {
      const context = requestContext(res, req);
      return ok(res, {
        operation: operationService.reject({
          operationId: req.params.operationId,
          reason: res.locals.body.reason,
          ...context
        })
      });
    }),

    execute: asyncHandler(async (req, res) => {
      const context = requestContext(res, req);
      const operation = await operationService.execute({
        operationId: req.params.operationId,
        confirmDestructive: res.locals.body.confirmDestructive,
        ...context
      });
      return ok(res, { operation });
    })
  };
}

export function createActivityController({ auditService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      return ok(res, {
        events: auditService.list({
          limit,
          path: req.query.path ?? null,
          result: req.query.result ?? null,
          operationId: req.query.operationId ?? null
        })
      });
    })
  };
}
