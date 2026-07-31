import express from 'express';
import cors from 'cors';

import { loadEnv } from './config/env.js';
import { GitHubClient } from './integrations/github/githubClient.js';
import { createReasoningProvider } from './integrations/nvidia/nvidiaProvider.js';

import { VaultRepository } from './repositories/vaultRepository.js';
import { ProjectRepository } from './repositories/projectRepository.js';
import { BusinessRepository } from './repositories/businessRepository.js';
import { TaskRepository } from './repositories/taskRepository.js';
import { MemoryRepository } from './repositories/memoryRepository.js';
import {
  DailyRepository,
  InboxRepository,
  KnowledgeRepository
} from './repositories/captureRepository.js';

import { BusinessService, ProjectService } from './services/projectService.js';
import { TaskService } from './services/taskService.js';
import { AuditService } from './services/auditService.js';
import { OperationService } from './services/operationService.js';
import { RetrievalService, SearchService } from './services/retrievalService.js';
import { PlanningService } from './services/planningService.js';
import { ConversationService } from './services/conversationService.js';
import { MemoryService } from './services/memoryService.js';
import { DocumentService } from './services/documentService.js';
import { DailyService, InboxService, KnowledgeService } from './services/captureService.js';
import { ReportService } from './services/reportService.js';

import { createHealthController } from './controllers/healthController.js';
import { createBusinessController, createProjectController } from './controllers/projectController.js';
import { createPlanningController, createTaskController } from './controllers/taskController.js';
import { createSearchController, createVaultController } from './controllers/vaultController.js';
import { createActivityController, createOperationController } from './controllers/operationController.js';
import { createConversationController } from './controllers/conversationController.js';
import { createMemoryController } from './controllers/memoryController.js';
import {
  createDailyController,
  createInboxController,
  createKnowledgeController,
  createReportController,
  createSettingsController
} from './controllers/captureController.js';

import { createApiRouter } from './routes/index.js';
import { requestId } from './middleware/requestId.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { notFound } from './middleware/notFound.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { createStores } from './stores/memoryStore.js';
import { createLogger } from './utils/logger.js';

/**
 * Composition root.
 *
 * Dependencies are injected downward so every layer stays testable in
 * isolation: `fetchImpl` substitutes GitHub, `aiFetchImpl` substitutes the
 * reasoning provider, and `now` makes date-dependent behavior deterministic.
 */
export function createApp({
  environment = process.env,
  fetchImpl = fetch,
  aiFetchImpl = null,
  stores = createStores(),
  now = () => new Date()
} = {}) {
  const env = loadEnv(environment);
  const logger = createLogger({ enabled: env.logEnabled });

  const githubClient = new GitHubClient({
    token: env.githubToken,
    owner: env.githubOwner,
    repo: env.githubVaultRepo,
    branch: env.githubVaultBranch,
    fetchImpl
  });

  const provider = createReasoningProvider({
    env,
    fetchImpl: aiFetchImpl ?? fetchImpl,
    logger
  });

  const vaultRepository = new VaultRepository({
    githubClient,
    readPaths: env.vaultReadPaths,
    writePaths: env.vaultWritePaths,
    searchMaxFiles: env.searchMaxFiles
  });

  const projectRepository = new ProjectRepository({ vaultRepository });
  const businessRepository = new BusinessRepository({ vaultRepository });
  const taskRepository = new TaskRepository({ vaultRepository, projectRepository });
  const memoryRepository = new MemoryRepository({ vaultRepository });
  const inboxRepository = new InboxRepository({ vaultRepository });
  const dailyRepository = new DailyRepository({ vaultRepository });
  const knowledgeRepository = new KnowledgeRepository({ vaultRepository });

  const auditService = new AuditService({ store: stores.audit, logger, now });
  const operationService = new OperationService({
    env,
    vaultRepository,
    auditService,
    operationStore: stores.operations,
    idempotencyStore: stores.idempotency,
    logger,
    now
  });

  const retrievalService = new RetrievalService({
    vaultRepository,
    projectRepository,
    businessRepository,
    taskRepository,
    env
  });
  const searchService = new SearchService({
    vaultRepository,
    projectRepository,
    businessRepository,
    env
  });
  const taskService = new TaskService({ taskRepository, operationService, now });
  const planningService = new PlanningService({
    taskRepository,
    projectRepository,
    businessRepository,
    dailyRepository,
    retrievalService,
    auditService,
    provider,
    now
  });
  const conversationService = new ConversationService({
    conversationStore: stores.conversations,
    retrievalService,
    operationService,
    provider,
    env,
    logger,
    now
  });
  const memoryService = new MemoryService({
    memoryRepository,
    operationService,
    proposalStore: stores.memoryProposals,
    now
  });
  const documentService = new DocumentService({ vaultRepository });
  const inboxService = new InboxService({
    inboxRepository,
    operationService,
    provider,
    retrievalService,
    now
  });
  const dailyService = new DailyService({ dailyRepository, operationService, now });
  const knowledgeService = new KnowledgeService({ knowledgeRepository, vaultRepository });
  const reportService = new ReportService({
    taskService,
    projectRepository,
    businessRepository,
    auditService,
    retrievalService,
    provider,
    now
  });

  const controllers = {
    health: createHealthController({ githubClient, provider, env }),
    project: createProjectController({ projectService: new ProjectService(projectRepository) }),
    business: createBusinessController({ businessService: new BusinessService(businessRepository) }),
    task: createTaskController({ taskService }),
    planning: createPlanningController({ planningService }),
    vault: createVaultController({ documentService, operationService }),
    search: createSearchController({ searchService }),
    conversation: createConversationController({ conversationService }),
    memory: createMemoryController({ memoryService }),
    operation: createOperationController({ operationService, auditService }),
    activity: createActivityController({ auditService }),
    inbox: createInboxController({ inboxService }),
    daily: createDailyController({ dailyService }),
    knowledge: createKnowledgeController({ knowledgeService }),
    report: createReportController({ reportService }),
    settings: createSettingsController({ env, provider, githubClient, operationService })
  };

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Runs first so preflight and parser-rejected requests still carry a request ID.
  app.use(requestId);
  app.use(cors({ origin: env.clientUrl }));
  app.use(express.json({ limit: '2mb' }));
  app.use(createRateLimiter({ windowMs: env.rateLimitWindowMs, max: env.rateLimitMaxRequests }));

  app.use(
    '/api/v1',
    createApiRouter({
      controllers,
      aiRateLimiter: createRateLimiter({ windowMs: env.rateLimitWindowMs, max: 60 })
    })
  );
  app.use(notFound);
  app.use(createErrorHandler({ logger }));

  app.locals.nexus = {
    env,
    provider,
    services: {
      auditService,
      operationService,
      taskService,
      planningService,
      conversationService,
      memoryService,
      documentService,
      searchService,
      retrievalService,
      reportService
    }
  };

  return app;
}
