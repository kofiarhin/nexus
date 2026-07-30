import express from 'express';
import cors from 'cors';
import { loadEnv } from './config/env.js';
import { GitHubClient } from './integrations/github/githubClient.js';
import { ProjectRepository } from './repositories/projectRepository.js';
import { ProjectService } from './services/projectService.js';
import { createHealthController } from './controllers/healthController.js';
import { createProjectController } from './controllers/projectController.js';
import { createApiRouter } from './routes/index.js';
import { requestId } from './middleware/requestId.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp({ environment = process.env, fetchImpl = fetch } = {}) {
  const env = loadEnv(environment);
  const githubClient = new GitHubClient({
    token: env.githubToken,
    owner: env.githubOwner,
    repo: env.githubVaultRepo,
    branch: env.githubVaultBranch,
    fetchImpl
  });
  const projectService = new ProjectService(new ProjectRepository(githubClient));
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.clientUrl }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);
  app.use('/api/v1', createApiRouter({
    healthController: createHealthController({ githubClient }),
    projectController: createProjectController({ projectService })
  }));
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
