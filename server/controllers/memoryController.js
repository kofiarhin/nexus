import { ok, created } from '../utils/respond.js';
import { asyncHandler, requestContext } from './helpers.js';

export function createMemoryController({ memoryService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const memory = await memoryService.list();
      return ok(res, { ...memory, proposals: memoryService.listProposals() });
    }),

    propose: asyncHandler(async (req, res) => {
      const proposal = await memoryService.propose({
        ...res.locals.body,
        actor: res.locals.principal
      });
      return created(res, { proposal });
    }),

    approve: asyncHandler(async (req, res) => {
      const result = await memoryService.approve({
        proposalId: req.params.proposalId,
        ...res.locals.body,
        ...requestContext(res, req)
      });
      return ok(res, result);
    }),

    reject: asyncHandler(async (req, res) => {
      return ok(res, {
        proposal: memoryService.reject({
          proposalId: req.params.proposalId,
          reason: res.locals.body?.reason
        })
      });
    }),

    update: asyncHandler(async (req, res) => {
      const result = await memoryService.update({
        memoryId: req.params.memoryId,
        ...res.locals.body,
        ...requestContext(res, req)
      });
      return ok(res, result);
    }),

    remove: asyncHandler(async (req, res) => {
      const result = await memoryService.remove({
        memoryId: req.params.memoryId,
        ...requestContext(res, req)
      });
      return ok(res, result);
    })
  };
}
