import { Router } from 'express';

export function createApiRouter({ healthController, projectController }) {
  const router = Router();
  router.get('/health', healthController.health);
  router.get('/health/vault', healthController.vault);
  router.get('/projects', projectController.list);
  return router;
}
