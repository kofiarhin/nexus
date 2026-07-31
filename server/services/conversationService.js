import { appError } from '../utils/errors.js';
import { mapCitations } from '../utils/citations.js';
import { newId } from '../utils/ids.js';
import { RetrievalService } from './retrievalService.js';

const MAX_HISTORY_MESSAGES = 12;

/**
 * Vault-grounded conversation (specification section 13).
 *
 * A transcript is working context, never automatic long-term memory. Any
 * mutation the model suggests becomes a validated operation proposal in the
 * `proposed` state; the model cannot approve or execute anything.
 */
export class ConversationService {
  constructor({
    conversationStore,
    retrievalService,
    operationService,
    provider,
    env,
    logger,
    now = () => new Date()
  }) {
    this.conversations = conversationStore;
    this.retrievalService = retrievalService;
    this.operationService = operationService;
    this.provider = provider;
    this.env = env;
    this.logger = logger;
    this.now = now;
  }

  create({ title = 'New conversation', scope = { type: 'vault', ids: [] }, actor }) {
    const timestamp = this.now().toISOString();
    const conversation = {
      id: newId('cnv'),
      title,
      scope,
      messages: [],
      sourceManifest: [],
      actor: actor ? { id: actor.id, email: actor.email } : null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.conversations.set(conversation.id, conversation);
    return conversation;
  }

  get(conversationId) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) throw appError('NOT_FOUND', 'Conversation not found');
    return conversation;
  }

  list(limit = 30) {
    return this.conversations.list({ limit }).map(({ id, title, scope, createdAt, updatedAt, messages }) => ({
      id,
      title,
      scope,
      createdAt,
      updatedAt,
      messageCount: messages.length
    }));
  }

  delete(conversationId) {
    this.get(conversationId);
    return this.conversations.delete(conversationId);
  }

  #appendMessage(conversation, message) {
    const record = { id: newId('msg'), createdAt: this.now().toISOString(), ...message };
    const messages = [...conversation.messages, record];
    this.conversations.update(conversation.id, { messages });
    return record;
  }

  #history(conversation) {
    return conversation.messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({ role: message.role, content: message.content }));
  }

  /** Builds the bounded manifest for a turn and records the user message. */
  async prepareTurn({ conversationId, content }) {
    const conversation = this.get(conversationId);
    this.#appendMessage(conversation, { role: 'user', content });

    const context = await this.retrievalService.buildContext({
      scope: conversation.scope,
      query: content
    });
    const workspaceRules = await this.retrievalService.workspaceRules();

    return {
      conversation: this.get(conversationId),
      context,
      workspaceRules,
      manifest: RetrievalService.toManifest(context)
    };
  }

  /**
   * Sends a message and returns the assistant reply with citations, plus any
   * operation proposals the request produced.
   */
  async sendMessage({ conversationId, content, allowOperations = false, actor, requestId }) {
    if (!this.provider.isConfigured()) {
      throw appError(
        'AI_NOT_CONFIGURED',
        'The reasoning provider is not configured. Deterministic reads and administration remain available.'
      );
    }

    const { conversation, context, workspaceRules, manifest } = await this.prepareTurn({
      conversationId,
      content
    });

    const allowedOperations = allowOperations ? this.operationService.allowedActions : [];

    if (allowOperations && allowedOperations.length === 0) {
      throw appError(
        'VAULT_WRITE_DISABLED',
        'Vault write operations are disabled, so conversational changes cannot be proposed.'
      );
    }

    const result = allowOperations
      ? await this.provider.proposeOperations(content, context.sources, allowedOperations, {
        writablePaths: this.env.vaultWritePaths
      })
      : await this.provider.generateAnswer(this.#history(conversation), context.sources, { workspaceRules });

    const answer = allowOperations ? result.answer : result.text;
    const proposals = [];
    const rejected = [...(result.rejected ?? [])];

    for (const candidate of result.operations ?? []) {
      try {
        // Model output is re-authorized and re-validated by the operation
        // service exactly as a manual request would be.
        // eslint-disable-next-line no-await-in-loop
        const operation = await this.operationService.propose({
          actor,
          requestId,
          action: candidate.action,
          path: candidate.path,
          destinationPath: candidate.destinationPath ?? null,
          content: candidate.content ?? null,
          underHeading: candidate.underHeading ?? null,
          reason: candidate.reason,
          source: 'conversation',
          conversationId: conversation.id,
          sources: manifest
        });
        proposals.push(operation);
      } catch (error) {
        rejected.push({
          candidate: { action: candidate.action, path: candidate.path },
          errors: [{ field: 'operation', message: error?.expose ? error.message : 'Rejected by validation' }]
        });
      }
    }

    const message = this.#appendMessage(conversation, {
      role: 'assistant',
      content: answer,
      citations: result.citations ?? [],
      sourceManifest: manifest,
      operationIds: proposals.map((operation) => operation.id),
      model: result.model ?? null
    });

    this.conversations.update(conversation.id, { sourceManifest: manifest });

    return {
      message,
      conversation: this.get(conversationId),
      sourceManifest: manifest,
      operations: proposals,
      rejectedOperations: rejected,
      contextTruncated: context.truncated
    };
  }

  /**
   * Streams an assistant reply. The caller forwards deltas as Server-Sent
   * Events; the completed message keeps its citations and manifest.
   */
  async *streamMessage({ conversationId, content }) {
    if (!this.provider.isConfigured()) {
      throw appError('AI_NOT_CONFIGURED', 'The reasoning provider is not configured');
    }

    const { conversation, context, workspaceRules, manifest } = await this.prepareTurn({
      conversationId,
      content
    });

    yield { type: 'manifest', sourceManifest: manifest };

    let text = '';
    try {
      for await (const delta of this.provider.streamAnswer(this.#history(conversation), context.sources, {
        workspaceRules
      })) {
        text += delta;
        yield { type: 'delta', text: delta };
      }
    } catch (error) {
      yield {
        type: 'error',
        code: error?.code ?? 'AI_UPSTREAM_ERROR',
        message: error?.expose ? error.message : 'The reasoning provider is unavailable'
      };
      return;
    }

    const message = this.#appendMessage(conversation, {
      role: 'assistant',
      content: text,
      citations: mapCitations(text, context.sources),
      sourceManifest: manifest,
      operationIds: []
    });

    this.conversations.update(conversation.id, { sourceManifest: manifest });

    yield { type: 'message', message };
  }
}
