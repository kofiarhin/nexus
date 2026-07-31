import { ok, created } from '../utils/respond.js';
import { asyncHandler, requestContext } from './helpers.js';

/**
 * Manual Vault administration.
 *
 * Every mutating route delegates to the same operation service the
 * conversational path uses, so validation, diffs, approval, concurrency, and
 * audit behave identically.
 */
export function createVaultController({ documentService, operationService }) {
  const mutate = (action, buildInput) => asyncHandler(async (req, res) => {
    const context = requestContext(res, req);
    const { operation, executed } = await operationService.proposeAndMaybeExecute({
      ...context,
      action,
      ...buildInput(res.locals.body ?? {}, req)
    });
    return ok(res, { operation, executed });
  });

  return {
    tree: asyncHandler(async (req, res) => {
      return ok(res, await documentService.tree(res.locals.query));
    }),

    read: asyncHandler(async (req, res) => {
      const { path, ref } = res.locals.query;
      return ok(res, { file: await documentService.read(path, ref) });
    }),

    history: asyncHandler(async (req, res) => {
      const { path } = res.locals.query;
      return ok(res, await documentService.history(path));
    }),

    create: asyncHandler(async (req, res) => {
      const context = requestContext(res, req);
      const body = res.locals.body;
      const { operation, executed } = await operationService.proposeAndMaybeExecute({
        ...context,
        action: 'create',
        path: body.path,
        content: body.content ?? '',
        reason: body.reason,
        message: body.message,
        source: 'manual'
      });
      return created(res, { operation, executed });
    }),

    replace: mutate('replace', (body) => ({
      path: body.path,
      content: body.content ?? '',
      expectedSha: body.expectedSha ?? body.revision,
      reason: body.reason,
      message: body.message,
      source: 'manual'
    })),

    append: mutate('append', (body) => ({
      path: body.path,
      content: body.content ?? '',
      underHeading: body.underHeading ?? null,
      expectedSha: body.expectedSha ?? body.revision,
      reason: body.reason,
      message: body.message,
      source: 'manual'
    })),

    move: mutate('move', (body) => ({
      path: body.path,
      destinationPath: body.destinationPath,
      expectedSha: body.expectedSha ?? body.revision,
      reason: body.reason,
      message: body.message,
      source: 'manual'
    })),

    archive: mutate('archive', (body) => ({
      path: body.path,
      destinationPath: body.destinationPath ?? null,
      expectedSha: body.expectedSha ?? body.revision,
      reason: body.reason,
      message: body.message,
      source: 'manual'
    })),

    /** Hard delete always proposes first; it can never auto-execute. */
    remove: asyncHandler(async (req, res) => {
      const context = requestContext(res, req);
      const body = res.locals.body;
      const operation = await operationService.propose({
        ...context,
        action: 'delete',
        path: body.path,
        expectedSha: body.expectedSha ?? body.revision,
        reason: body.reason,
        message: body.message,
        source: 'manual'
      });
      return ok(res, { operation, executed: false });
    }),

    restore: asyncHandler(async (req, res) => {
      const context = requestContext(res, req);
      const body = res.locals.body;
      const operation = await operationService.propose({
        ...context,
        action: 'restore',
        path: body.path,
        restoreRevision: body.revision,
        expectedSha: body.expectedSha,
        reason: body.reason,
        message: `Restore ${body.path}`,
        source: 'manual'
      });
      return ok(res, { operation, executed: false });
    })
  };
}

export function createSearchController({ searchService }) {
  return {
    search: asyncHandler(async (req, res) => {
      return ok(res, await searchService.search(res.locals.query));
    })
  };
}
