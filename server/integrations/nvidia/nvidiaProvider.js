import { NvidiaClient } from './nvidiaClient.js';
import {
  buildAnswerMessages,
  buildOperationMessages,
  buildPlanMessages,
  buildSummaryMessages,
  extractJsonObject,
  mapCitations
} from './prompts.js';
import { modelOperationSchema } from '../../schemas/index.js';
import { tryValidate } from '../../schemas/validate.js';
import { appError } from '../../utils/errors.js';

/**
 * Replaceable reasoning provider backed by NVIDIA.
 *
 * The provider returns proposals and prose only. Everything it produces is
 * treated as untrusted input: operation candidates are schema-validated here
 * and re-authorized by the operation service before anything is written.
 */
export function createNvidiaProvider({ client, logger }) {
  const run = async (event, messages, options) => {
    const started = Date.now();
    try {
      const result = await client.complete(messages, options);
      logger?.info('ai.request', {
        event,
        provider: 'nvidia',
        model: result.model,
        durationMs: Date.now() - started,
        outcome: 'succeeded',
        usage: result.usage
      });
      return result;
    } catch (error) {
      logger?.warn('ai.request', {
        event,
        provider: 'nvidia',
        durationMs: Date.now() - started,
        outcome: 'failed',
        code: error?.code ?? 'AI_UPSTREAM_ERROR'
      });
      throw error;
    }
  };

  return {
    name: 'nvidia',

    isConfigured: () => client.isConfigured(),

    get model() {
      return client.model;
    },

    async generateAnswer(messages, contextManifest = [], options = {}) {
      const result = await run(
        'generateAnswer',
        buildAnswerMessages({
          messages,
          sources: contextManifest,
          workspaceRules: options.workspaceRules
        }),
        options
      );
      return {
        text: result.text,
        citations: mapCitations(result.text, contextManifest),
        model: result.model,
        usage: result.usage
      };
    },

    async *streamAnswer(messages, contextManifest = [], options = {}) {
      yield* client.stream(
        buildAnswerMessages({
          messages,
          sources: contextManifest,
          workspaceRules: options.workspaceRules
        }),
        options
      );
    },

    async generatePlan(goal, contextManifest = [], options = {}) {
      const result = await run(
        'generatePlan',
        buildPlanMessages({ goal, sources: contextManifest, facts: options.facts ?? {} }),
        options
      );
      return {
        text: result.text,
        citations: mapCitations(result.text, contextManifest),
        model: result.model
      };
    },

    async generateSummary(content, contextManifest = [], options = {}) {
      const result = await run(
        'generateSummary',
        buildSummaryMessages({
          content,
          sources: contextManifest,
          instruction: options.instruction
        }),
        options
      );
      return {
        text: result.text,
        citations: mapCitations(result.text, contextManifest),
        model: result.model
      };
    },

    async proposeOperations(instruction, contextManifest = [], allowedOperations = [], options = {}) {
      const result = await run(
        'proposeOperations',
        buildOperationMessages({
          instruction,
          sources: contextManifest,
          allowedOperations,
          writablePaths: options.writablePaths ?? []
        }),
        { ...options, temperature: 0 }
      );

      const parsed = extractJsonObject(result.text);
      if (!parsed) {
        return {
          answer: result.text,
          operations: [],
          rejected: [{ reason: 'The model did not return a parsable operation proposal' }],
          citations: mapCitations(result.text, contextManifest),
          model: result.model
        };
      }

      const candidates = Array.isArray(parsed.operations) ? parsed.operations.slice(0, 10) : [];
      const operations = [];
      const rejected = [];

      for (const candidate of candidates) {
        const { valid, value, errors } = tryValidate(candidate, modelOperationSchema);
        if (!valid) {
          rejected.push({ candidate: { action: candidate?.action, path: candidate?.path }, errors });
          continue;
        }
        if (!allowedOperations.includes(value.action)) {
          rejected.push({ candidate: { action: value.action, path: value.path }, errors: [{ field: 'action', message: 'is not an allowed operation' }] });
          continue;
        }
        operations.push(value);
      }

      const answer = typeof parsed.answer === 'string' ? parsed.answer : result.text;

      return {
        answer,
        operations,
        rejected,
        citations: mapCitations(answer, contextManifest),
        model: result.model
      };
    }
  };
}

/**
 * Used when no reasoning provider is configured.
 * Every call rejects rather than throwing synchronously, so callers can handle
 * an unavailable provider the same way they handle an upstream failure.
 */
export function createUnavailableProvider(reason = 'The reasoning provider is not configured') {
  const fail = async () => {
    throw appError('AI_NOT_CONFIGURED', reason);
  };
  return {
    name: 'unavailable',
    model: null,
    isConfigured: () => false,
    generateAnswer: fail,
    generatePlan: fail,
    generateSummary: fail,
    proposeOperations: fail,
    async *streamAnswer() {
      await fail();
    }
  };
}

export function createReasoningProvider({ env, fetchImpl = fetch, logger } = {}) {
  if (env.aiProvider !== 'nvidia') {
    return createUnavailableProvider(`Unsupported reasoning provider: ${env.aiProvider}`);
  }

  const client = new NvidiaClient({
    apiKey: env.nvidiaApiKey,
    model: env.nvidiaModel,
    baseUrl: env.nvidiaBaseUrl,
    timeoutMs: env.nvidiaTimeoutMs,
    maxOutputTokens: env.nvidiaMaxOutputTokens,
    fetchImpl
  });

  if (!client.isConfigured()) {
    return createUnavailableProvider('The NVIDIA reasoning provider is not configured');
  }

  return createNvidiaProvider({ client, logger });
}

export { NvidiaClient };
