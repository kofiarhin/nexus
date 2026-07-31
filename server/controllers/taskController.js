import { ok, created } from '../utils/respond.js';
import { asyncHandler, requestContext } from './helpers.js';

export function createTaskController({ taskService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const result = await taskService.list(res.locals.query);
      return ok(res, result);
    }),

    today: asyncHandler(async (req, res) => {
      const result = await taskService.list({ view: 'today' });
      return ok(res, result);
    }),

    summary: asyncHandler(async (req, res) => {
      return ok(res, { summary: await taskService.summary() });
    }),

    get: asyncHandler(async (req, res) => {
      return ok(res, await taskService.get(req.params.taskId));
    }),

    create: asyncHandler(async (req, res) => {
      const result = await taskService.create({ ...res.locals.body, ...requestContext(res, req) });
      return created(res, result);
    }),

    update: asyncHandler(async (req, res) => {
      const result = await taskService.update({
        taskId: req.params.taskId,
        ...res.locals.body,
        ...requestContext(res, req)
      });
      return ok(res, result);
    }),

    remove: asyncHandler(async (req, res) => {
      const result = await taskService.remove({
        taskId: req.params.taskId,
        ...requestContext(res, req)
      });
      return ok(res, result);
    })
  };
}

export function createPlanningController({ planningService }) {
  return {
    today: asyncHandler(async (req, res) => {
      return ok(res, await planningService.today());
    }),

    propose: asyncHandler(async (req, res) => {
      return ok(res, await planningService.proposePlan(res.locals.body));
    })
  };
}
