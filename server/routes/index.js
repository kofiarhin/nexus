import { Router } from 'express';
import { requireOwner } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  conversationCreateSchema,
  conversationMessageSchema,
  dailyAppendSchema,
  inboxCaptureSchema,
  knowledgeQuerySchema,
  loginSchema,
  memoryApproveSchema,
  memoryProposalSchema,
  memoryUpdateSchema,
  operationExecuteSchema,
  operationProposalSchema,
  operationRejectSchema,
  planningProposalSchema,
  reportQuerySchema,
  restoreSchema,
  searchQuerySchema,
  taskCreateSchema,
  taskQuerySchema,
  taskUpdateSchema,
  vaultAppendSchema,
  vaultArchiveSchema,
  vaultCreateSchema,
  vaultDeleteSchema,
  vaultMoveSchema,
  vaultReadQuerySchema,
  vaultReplaceSchema,
  vaultTreeQuerySchema
} from '../schemas/index.js';

/**
 * Versioned HTTP surface (specification section 18).
 * Routes carry no business logic: they bind authorization, validation, and a
 * controller handler.
 */
export function createApiRouter({
  controllers,
  authRateLimiter,
  aiRateLimiter,
  requireRead,
  requireWrite
}) {
  const router = Router();
  const {
    health,
    auth,
    project,
    business,
    task,
    planning,
    vault,
    search,
    conversation,
    memory,
    operation,
    activity,
    inbox,
    daily,
    knowledge,
    report,
    settings
  } = controllers;

  // Health is public so a deployment can be probed without a session.
  router.get('/health', health.health);
  router.get('/health/vault', health.vault);
  router.get('/health/ai', health.ai);

  router.get('/auth/status', auth.status);
  router.post('/auth/login', authRateLimiter, validateBody(loginSchema), auth.login);
  router.get('/auth/session', auth.session);
  router.post('/auth/logout', auth.logout);

  router.get('/projects', requireRead, project.list);
  router.get('/projects/:projectId', requireRead, project.get);
  router.get('/businesses', requireRead, business.list);
  router.get('/businesses/:businessId', requireRead, business.get);

  // Declared before `/tasks/:taskId` so the literal segments win.
  router.get('/tasks/today', requireRead, task.today);
  router.get('/tasks/summary', requireRead, task.summary);
  router.get('/tasks', requireRead, validateQuery(taskQuerySchema), task.list);
  router.post('/tasks', requireWrite, validateBody(taskCreateSchema), task.create);
  router.get('/tasks/:taskId', requireRead, task.get);
  router.patch('/tasks/:taskId', requireWrite, validateBody(taskUpdateSchema), task.update);
  router.delete('/tasks/:taskId', requireWrite, task.remove);

  router.get('/planning/today', requireRead, planning.today);
  router.post(
    '/planning/today/proposals',
    requireWrite,
    aiRateLimiter,
    validateBody(planningProposalSchema),
    planning.propose
  );

  router.get('/vault/tree', requireRead, validateQuery(vaultTreeQuerySchema), vault.tree);
  router.get('/vault/files', requireRead, validateQuery(vaultReadQuerySchema), vault.read);
  router.get('/vault/files/history', requireRead, validateQuery(vaultReadQuerySchema), vault.history);
  router.post('/vault/files', requireWrite, validateBody(vaultCreateSchema), vault.create);
  router.put('/vault/files', requireWrite, validateBody(vaultReplaceSchema), vault.replace);
  router.post('/vault/files/append', requireWrite, validateBody(vaultAppendSchema), vault.append);
  router.post('/vault/files/move', requireWrite, validateBody(vaultMoveSchema), vault.move);
  router.post('/vault/files/archive', requireWrite, validateBody(vaultArchiveSchema), vault.archive);
  router.delete('/vault/files', requireWrite, validateBody(vaultDeleteSchema), vault.remove);
  router.post('/vault/files/restore', requireWrite, validateBody(restoreSchema), vault.restore);

  router.get('/search', requireRead, validateQuery(searchQuerySchema), search.search);

  router.get('/conversations', requireRead, conversation.list);
  router.post('/conversations', requireWrite, validateBody(conversationCreateSchema), conversation.create);
  router.get('/conversations/:conversationId', requireRead, conversation.get);
  router.delete('/conversations/:conversationId', requireWrite, conversation.remove);
  router.post(
    '/conversations/:conversationId/messages',
    requireWrite,
    aiRateLimiter,
    validateBody(conversationMessageSchema),
    conversation.message
  );

  router.get('/memory', requireRead, memory.list);
  router.post('/memory/proposals', requireWrite, validateBody(memoryProposalSchema), memory.propose);
  router.post(
    '/memory/proposals/:proposalId/approve',
    requireWrite,
    validateBody(memoryApproveSchema),
    memory.approve
  );
  router.post(
    '/memory/proposals/:proposalId/reject',
    requireWrite,
    validateBody(operationRejectSchema),
    memory.reject
  );
  router.patch('/memory/:memoryId', requireWrite, validateBody(memoryUpdateSchema), memory.update);
  router.delete('/memory/:memoryId', requireWrite, memory.remove);

  router.get('/operations', requireRead, operation.list);
  router.post('/operations/proposals', requireWrite, validateBody(operationProposalSchema), operation.propose);
  router.get('/operations/:operationId', requireRead, operation.get);
  router.post('/operations/:operationId/approve', requireWrite, operation.approve);
  router.post(
    '/operations/:operationId/reject',
    requireWrite,
    validateBody(operationRejectSchema),
    operation.reject
  );
  router.post(
    '/operations/:operationId/execute',
    requireWrite,
    validateBody(operationExecuteSchema),
    operation.execute
  );

  router.get('/activity', requireRead, activity.list);

  router.get('/inbox', requireRead, inbox.list);
  router.post('/inbox', requireWrite, validateBody(inboxCaptureSchema), inbox.capture);
  router.get('/inbox/:entryId/suggestion', requireRead, aiRateLimiter, inbox.suggest);
  router.post('/inbox/:entryId/promote', requireWrite, inbox.promote);
  router.delete('/inbox/:entryId', requireWrite, inbox.remove);

  router.get('/daily', requireRead, daily.list);
  router.get('/daily/:date', requireRead, daily.get);
  router.post('/daily/:date/entries', requireWrite, validateBody(dailyAppendSchema), daily.append);

  router.get('/knowledge', requireRead, knowledge.list);
  router.get('/knowledge/note', requireRead, validateQuery(knowledgeQuerySchema), knowledge.get);

  router.get('/reports', requireRead, validateQuery(reportQuerySchema), report.generate);

  router.get('/settings', requireRead, requireOwner, settings.get);

  return router;
}
