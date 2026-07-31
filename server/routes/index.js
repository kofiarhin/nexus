import { Router } from 'express';
import { validateBody, validateQuery } from '../middleware/validate.js';
import {
  conversationCreateSchema,
  conversationMessageSchema,
  dailyAppendSchema,
  inboxCaptureSchema,
  knowledgeQuerySchema,
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
 * Routes carry no business logic: they bind validation and a controller
 * handler.
 */
export function createApiRouter({ controllers, aiRateLimiter }) {
  const router = Router();
  const {
    health,
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

  // Health can be probed without touching Vault-backed controllers.
  router.get('/health', health.health);
  router.get('/health/vault', health.vault);
  router.get('/health/ai', health.ai);

  router.get('/projects', project.list);
  router.get('/projects/:projectId', project.get);
  router.get('/businesses', business.list);
  router.get('/businesses/:businessId', business.get);

  // Declared before `/tasks/:taskId` so the literal segments win.
  router.get('/tasks/today', task.today);
  router.get('/tasks/summary', task.summary);
  router.get('/tasks', validateQuery(taskQuerySchema), task.list);
  router.post('/tasks', validateBody(taskCreateSchema), task.create);
  router.get('/tasks/:taskId', task.get);
  router.patch('/tasks/:taskId', validateBody(taskUpdateSchema), task.update);
  router.delete('/tasks/:taskId', task.remove);

  router.get('/planning/today', planning.today);
  router.post(
    '/planning/today/proposals',
    aiRateLimiter,
    validateBody(planningProposalSchema),
    planning.propose
  );

  router.get('/vault/tree', validateQuery(vaultTreeQuerySchema), vault.tree);
  router.get('/vault/files', validateQuery(vaultReadQuerySchema), vault.read);
  router.get('/vault/files/history', validateQuery(vaultReadQuerySchema), vault.history);
  router.post('/vault/files', validateBody(vaultCreateSchema), vault.create);
  router.put('/vault/files', validateBody(vaultReplaceSchema), vault.replace);
  router.post('/vault/files/append', validateBody(vaultAppendSchema), vault.append);
  router.post('/vault/files/move', validateBody(vaultMoveSchema), vault.move);
  router.post('/vault/files/archive', validateBody(vaultArchiveSchema), vault.archive);
  router.delete('/vault/files', validateBody(vaultDeleteSchema), vault.remove);
  router.post('/vault/files/restore', validateBody(restoreSchema), vault.restore);

  router.get('/search', validateQuery(searchQuerySchema), search.search);

  router.get('/conversations', conversation.list);
  router.post('/conversations', validateBody(conversationCreateSchema), conversation.create);
  router.get('/conversations/:conversationId', conversation.get);
  router.delete('/conversations/:conversationId', conversation.remove);
  router.post(
    '/conversations/:conversationId/messages',
    aiRateLimiter,
    validateBody(conversationMessageSchema),
    conversation.message
  );

  router.get('/memory', memory.list);
  router.post('/memory/proposals', validateBody(memoryProposalSchema), memory.propose);
  router.post(
    '/memory/proposals/:proposalId/approve',
    validateBody(memoryApproveSchema),
    memory.approve
  );
  router.post(
    '/memory/proposals/:proposalId/reject',
    validateBody(operationRejectSchema),
    memory.reject
  );
  router.patch('/memory/:memoryId', validateBody(memoryUpdateSchema), memory.update);
  router.delete('/memory/:memoryId', memory.remove);

  router.get('/operations', operation.list);
  router.post('/operations/proposals', validateBody(operationProposalSchema), operation.propose);
  router.get('/operations/:operationId', operation.get);
  router.post('/operations/:operationId/approve', operation.approve);
  router.post(
    '/operations/:operationId/reject',
    validateBody(operationRejectSchema),
    operation.reject
  );
  router.post(
    '/operations/:operationId/execute',
    validateBody(operationExecuteSchema),
    operation.execute
  );

  router.get('/activity', activity.list);

  router.get('/inbox', inbox.list);
  router.post('/inbox', validateBody(inboxCaptureSchema), inbox.capture);
  router.get('/inbox/:entryId/suggestion', aiRateLimiter, inbox.suggest);
  router.post('/inbox/:entryId/promote', inbox.promote);
  router.delete('/inbox/:entryId', inbox.remove);

  router.get('/daily', daily.list);
  router.get('/daily/:date', daily.get);
  router.post('/daily/:date/entries', validateBody(dailyAppendSchema), daily.append);

  router.get('/knowledge', knowledge.list);
  router.get('/knowledge/note', validateQuery(knowledgeQuerySchema), knowledge.get);

  router.get('/reports', validateQuery(reportQuerySchema), report.generate);

  router.get('/settings', settings.get);

  return router;
}
