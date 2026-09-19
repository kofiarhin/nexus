import { VAULT_PATHS } from '../config/policy.js';
import { serializeInboxEntry } from '../repositories/captureRepository.js';
import { dailyNotePath } from '../repositories/captureRepository.js';
import { appError } from '../utils/errors.js';
import { derivedId } from '../utils/ids.js';
import { replaceLine } from '../utils/markdown.js';

/**
 * Quick capture.
 *
 * Captured content stays raw and uncommitted until it is explicitly promoted.
 * Nexus may suggest a classification, but a suggestion never moves a record on
 * its own.
 */
export class InboxService {
  constructor({ inboxRepository, operationService, provider, retrievalService, now = () => new Date() }) {
    this.inboxRepository = inboxRepository;
    this.operationService = operationService;
    this.provider = provider;
    this.retrievalService = retrievalService;
    this.now = now;
  }

  async list() {
    const { entries, path, revision } = await this.inboxRepository.list();
    return {
      entries,
      path,
      revision,
      sources: [{ path, sha: revision, title: 'Inbox', reason: 'Captured items' }]
    };
  }

  async capture({ content, kind = 'unclassified', actor, requestId, idempotencyKey }) {
    const file = await this.inboxRepository.readFile();
    const entry = {
      id: derivedId('inb', this.inboxRepository.inboxPath, `${content}:${this.now().toISOString()}`),
      content,
      kind,
      capturedAt: this.now().toISOString().slice(0, 10),
      status: 'open'
    };

    const line = serializeInboxEntry(entry);

    const request = file.revision
      ? { action: 'append', path: file.path, content: line, underHeading: 'Captured', expectedSha: file.revision }
      : { action: 'create', path: VAULT_PATHS.inboxFile, content: `# Inbox\n\n## Captured\n\n${line}\n` };

    const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
      actor,
      requestId,
      idempotencyKey,
      ...request,
      reason: `Capture ${kind}`,
      message: `Capture inbox item ${entry.id}`,
      source: 'manual'
    });

    return { entry, operation, executed };
  }

  /** Marks a captured item as promoted; it does not create the destination. */
  async markPromoted({ entryId, destination, actor, requestId, idempotencyKey }) {
    const found = await this.inboxRepository.get(entryId);
    if (!found) throw appError('NOT_FOUND', 'Inbox entry not found');

    const file = await this.inboxRepository.readFile();
    const updated = { ...found.entry, status: 'promoted', promotedTo: destination ?? null };
    const content = replaceLine(file.content, found.entry.sourceLine, serializeInboxEntry(updated));

    const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
      actor,
      requestId,
      idempotencyKey,
      action: 'replace',
      path: file.path,
      content,
      expectedSha: file.revision,
      reason: `Promote inbox entry ${entryId}`,
      message: `Promote inbox entry ${entryId}`,
      source: 'manual'
    });

    return { entry: updated, operation, executed };
  }

  async remove({ entryId, actor, requestId, idempotencyKey }) {
    const found = await this.inboxRepository.get(entryId);
    if (!found) throw appError('NOT_FOUND', 'Inbox entry not found');

    const file = await this.inboxRepository.readFile();
    const content = replaceLine(file.content, found.entry.sourceLine, null);

    const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
      actor,
      requestId,
      idempotencyKey,
      action: 'replace',
      path: file.path,
      content,
      expectedSha: file.revision,
      reason: `Discard inbox entry ${entryId}`,
      message: `Discard inbox entry ${entryId}`,
      source: 'manual'
    });

    return { entry: found.entry, operation, executed };
  }

  /**
   * Suggests a destination and classification for a captured item.
   * The suggestion is advisory: promoting still requires an explicit request.
   */
  async suggest({ entryId }) {
    const found = await this.inboxRepository.get(entryId);
    if (!found) throw appError('NOT_FOUND', 'Inbox entry not found');

    if (!this.provider.isConfigured()) {
      return {
        entry: found.entry,
        suggestion: null,
        aiAvailable: false,
        reason: 'The reasoning provider is not configured'
      };
    }

    const context = await this.retrievalService.buildContext({
      scope: { type: 'vault', ids: [] },
      query: found.entry.content
    });

    const result = await this.provider.generateSummary(found.entry.content, context.sources, {
      instruction:
        'Suggest a classification (note, idea, task, request) and a destination Vault path for this captured item. '
        + 'State it as a recommendation with citations. Do not claim the item has been moved.'
    });

    return {
      entry: found.entry,
      suggestion: { text: result.text, citations: result.citations, basis: 'ai-recommendation' },
      aiAvailable: true
    };
  }
}

/** Daily notes: read the note for a date, and append plan or reflection lines. */
export class DailyService {
  constructor({ dailyRepository, operationService, now = () => new Date() }) {
    this.dailyRepository = dailyRepository;
    this.operationService = operationService;
    this.now = now;
  }

  today() {
    return this.now().toISOString().slice(0, 10);
  }

  list(limit) {
    return this.dailyRepository.list(limit);
  }

  get(date) {
    return this.dailyRepository.get(date ?? this.today());
  }

  async appendEntry({ date, section = 'Notes', content, actor, requestId, idempotencyKey }) {
    const day = date ?? this.today();
    const note = await this.dailyRepository.get(day);
    const line = `- ${content}`;

    const request = note.exists
      ? { action: 'append', path: note.path, content: line, underHeading: section, expectedSha: note.revision }
      : {
        action: 'create',
        path: dailyNotePath(day),
        content: `# ${day}\n\n## Plan\n\n## Notes\n\n${section === 'Notes' ? line : ''}\n`
      };

    const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
      actor,
      requestId,
      idempotencyKey,
      ...request,
      reason: `Daily note entry for ${day}`,
      message: `Update daily note ${day}`,
      source: 'manual'
    });

    return { date: day, operation, executed };
  }
}

/** Knowledge notes with backlink discovery across the readable Vault. */
export class KnowledgeService {
  constructor({ knowledgeRepository, vaultRepository }) {
    this.knowledgeRepository = knowledgeRepository;
    this.vaultRepository = vaultRepository;
  }

  list() {
    return this.knowledgeRepository.list();
  }

  async get(path) {
    const note = await this.knowledgeRepository.get(path);
    const name = note.path.split('/').pop().replace(/\.md$/i, '');

    const backlinks = await this.vaultRepository
      .searchText(name, { limit: 10 })
      .then((search) => search.results.filter((result) => result.path !== note.path))
      .catch(() => []);

    return {
      ...note,
      backlinks: backlinks.map((result) => ({ path: result.path, title: result.title })),
      sources: [{ path: note.path, sha: note.revision, title: note.title, reason: 'Requested knowledge note' }]
    };
  }
}
