import { ok, created } from '../utils/respond.js';
import { asyncHandler, requestContext } from './helpers.js';

export function createInboxController({ inboxService }) {
  return {
    list: asyncHandler(async (req, res) => {
      return ok(res, await inboxService.list());
    }),

    capture: asyncHandler(async (req, res) => {
      const result = await inboxService.capture({ ...res.locals.body, ...requestContext(res, req) });
      return created(res, result);
    }),

    suggest: asyncHandler(async (req, res) => {
      return ok(res, await inboxService.suggest({ entryId: req.params.entryId }));
    }),

    promote: asyncHandler(async (req, res) => {
      const result = await inboxService.markPromoted({
        entryId: req.params.entryId,
        destination: req.body?.destination ?? null,
        ...requestContext(res, req)
      });
      return ok(res, result);
    }),

    remove: asyncHandler(async (req, res) => {
      const result = await inboxService.remove({
        entryId: req.params.entryId,
        ...requestContext(res, req)
      });
      return ok(res, result);
    })
  };
}

export function createDailyController({ dailyService }) {
  return {
    list: asyncHandler(async (req, res) => {
      return ok(res, { notes: await dailyService.list(Math.min(Number(req.query.limit) || 30, 90)) });
    }),

    get: asyncHandler(async (req, res) => {
      return ok(res, { note: await dailyService.get(req.params.date) });
    }),

    append: asyncHandler(async (req, res) => {
      const result = await dailyService.appendEntry({
        date: req.params.date,
        section: req.body?.section ?? 'Notes',
        content: res.locals.body.content,
        ...requestContext(res, req)
      });
      return ok(res, result);
    })
  };
}

export function createKnowledgeController({ knowledgeService }) {
  return {
    list: asyncHandler(async (req, res) => {
      return ok(res, { notes: await knowledgeService.list() });
    }),

    get: asyncHandler(async (req, res) => {
      return ok(res, { note: await knowledgeService.get(res.locals.query.path) });
    })
  };
}

export function createReportController({ reportService }) {
  return {
    generate: asyncHandler(async (req, res) => {
      return ok(res, { report: await reportService.generate(res.locals.query) });
    })
  };
}

/** Read-only settings view: configuration state, never secret values. */
export function createSettingsController({ env, authService, provider, githubClient, operationService }) {
  return {
    get(req, res) {
      return ok(res, {
        authentication: authService.status(),
        vault: {
          repository: githubClient.repositoryName,
          branch: githubClient.branch,
          configured: githubClient.isConfigured(),
          readPaths: env.vaultReadPaths,
          writePaths: env.vaultWritePaths
        },
        reasoning: {
          provider: env.aiProvider,
          configured: provider.isConfigured(),
          model: provider.isConfigured() ? provider.model : null,
          timeoutMs: env.nvidiaTimeoutMs
        },
        operations: {
          writeOperationsEnabled: env.writeOperationsEnabled,
          writeOperationsRequested: env.writeOperationsRequested,
          destructiveOperationsEnabled: env.destructiveOperationsEnabled,
          destructiveOperationsRequested: env.destructiveOperationsRequested,
          autoApproveLowRisk: env.autoApproveLowRisk,
          allowedActions: operationService.allowedActions
        },
        context: {
          maxSources: env.contextMaxSources,
          maxCharacters: env.contextMaxCharacters,
          searchMaxFiles: env.searchMaxFiles
        },
        environment: { nodeEnv: env.nodeEnv }
      });
    }
  };
}
