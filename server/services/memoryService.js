import { VAULT_PATHS } from '../config/policy.js';
import { findConflicts, parseMemoryRecords, serializeMemory } from '../repositories/memoryRepository.js';
import { appError } from '../utils/errors.js';
import { derivedId, newId } from '../utils/ids.js';
import { replaceLine } from '../utils/markdown.js';

/**
 * Long-term memory (PRD section 8).
 *
 * Nothing inferred is stored silently. A proposal shows the exact statement,
 * its classification, its supporting sources, its target path, and any
 * conflicting memory; only an explicit approval turns it into a Vault write,
 * and that write goes through the operation pipeline.
 */
export class MemoryService {
  constructor({ memoryRepository, operationService, proposalStore, now = () => new Date() }) {
    this.memoryRepository = memoryRepository;
    this.operationService = operationService;
    this.proposals = proposalStore;
    this.now = now;
  }

  /**
   * A memory change is only ever reached through an explicit owner action on a
   * named record, so that request is the approval evidence recorded against the
   * operation before it executes.
   */
  async #approveAndExecute({ operation, actor, requestId, idempotencyKey }) {
    if (operation.requiresApproval) {
      this.operationService.approve({ operationId: operation.id, actor, requestId });
    }
    return this.operationService.execute({
      operationId: operation.id,
      actor,
      requestId,
      idempotencyKey
    });
  }

  async list() {
    const { records, path, revision } = await this.memoryRepository.list();
    return {
      records,
      path,
      revision,
      sources: [{ path, sha: revision, title: 'Long-term memory', reason: 'Approved durable memory' }]
    };
  }

  listProposals(limit = 50) {
    return this.proposals.list({ limit });
  }

  getProposal(proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw appError('NOT_FOUND', 'Memory proposal not found');
    return proposal;
  }

  /** Creates a reviewable memory proposal. Nothing is written yet. */
  async propose({ statement, type = 'fact', sources = [], conversationId = null, targetPath, confidence = 'medium', actor }) {
    const { records, path, revision } = await this.memoryRepository.list();
    const target = targetPath ?? path ?? VAULT_PATHS.memoryFile;

    const proposal = {
      id: newId('mem'),
      statement,
      type,
      sources,
      conversationId,
      targetPath: target,
      confidence,
      conflicts: findConflicts(records, statement),
      status: 'proposed',
      actor: actor ? { id: actor.id, email: actor.email } : null,
      targetRevision: revision,
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };

    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  /** Approving a proposal appends the statement through the operation pipeline. */
  async approve({ proposalId, actor, requestId, idempotencyKey, statement, type }) {
    const proposal = this.getProposal(proposalId);
    if (proposal.status !== 'proposed') {
      throw appError('CONFLICT', `Memory proposal cannot be approved from status "${proposal.status}"`);
    }

    const record = {
      id: derivedId('mem', proposal.targetPath, statement ?? proposal.statement),
      statement: statement ?? proposal.statement,
      type: type ?? proposal.type,
      sources: proposal.sources,
      confidence: proposal.confidence,
      conversationId: proposal.conversationId,
      createdAt: this.now().toISOString().slice(0, 10),
      updatedAt: this.now().toISOString().slice(0, 10)
    };

    const line = serializeMemory(record);
    const file = await this.memoryRepository.readFile();

    const request = file.revision
      ? {
        action: 'append',
        path: proposal.targetPath,
        content: line,
        underHeading: 'Records',
        expectedSha: file.revision
      }
      : {
        action: 'create',
        path: proposal.targetPath,
        content: `# Long-term memory\n\n## Records\n\n${line}\n`
      };

    const operation = await this.operationService.propose({
      actor,
      requestId,
      ...request,
      reason: `Approved memory: ${record.statement.slice(0, 80)}`,
      message: `Record memory ${record.id}`,
      sources: proposal.sources.map((path) => ({ path, reason: 'Supporting source for this memory' })),
      source: 'manual'
    });

    const executed = await this.#approveAndExecute({ operation, actor, requestId, idempotencyKey });

    this.proposals.update(proposalId, { status: 'approved', operationId: operation.id, record });

    return { proposal: this.getProposal(proposalId), operation: executed, record };
  }

  reject({ proposalId, reason = 'Rejected by owner' }) {
    const proposal = this.getProposal(proposalId);
    if (proposal.status !== 'proposed') {
      throw appError('CONFLICT', `Memory proposal cannot be rejected from status "${proposal.status}"`);
    }
    return this.proposals.update(proposalId, { status: 'rejected', reason });
  }

  /** Corrects a stored memory statement in place. */
  async update({ memoryId, statement, type, actor, requestId, idempotencyKey }) {
    const found = await this.memoryRepository.get(memoryId);
    if (!found) throw appError('NOT_FOUND', 'Memory record not found');

    const file = await this.memoryRepository.readFile();
    const records = parseMemoryRecords(file.content, file.path);
    const record = records.find((candidate) => candidate.id === memoryId);
    if (!record) throw appError('NOT_FOUND', 'Memory record not found');

    const updated = {
      ...record,
      statement: statement ?? record.statement,
      type: type ?? record.type,
      updatedAt: this.now().toISOString().slice(0, 10)
    };

    const content = replaceLine(file.content, record.sourceLine, serializeMemory(updated));

    const operation = await this.operationService.propose({
      actor,
      requestId,
      action: 'replace',
      path: file.path,
      content,
      expectedSha: file.revision,
      reason: `Correct memory ${memoryId}`,
      message: `Correct memory ${memoryId}`,
      source: 'manual'
    });

    const executed = await this.#approveAndExecute({ operation, actor, requestId, idempotencyKey });

    return { record: updated, operation: executed };
  }

  /** Forgetting removes the statement line; Git retains the history. */
  async remove({ memoryId, actor, requestId, idempotencyKey }) {
    const file = await this.memoryRepository.readFile();
    const records = parseMemoryRecords(file.content, file.path);
    const record = records.find((candidate) => candidate.id === memoryId);
    if (!record) throw appError('NOT_FOUND', 'Memory record not found');

    const content = replaceLine(file.content, record.sourceLine, null);

    const operation = await this.operationService.propose({
      actor,
      requestId,
      action: 'replace',
      path: file.path,
      content,
      expectedSha: file.revision,
      reason: `Forget memory ${memoryId}`,
      message: `Forget memory ${memoryId}`,
      source: 'manual'
    });

    const executed = await this.#approveAndExecute({ operation, actor, requestId, idempotencyKey });

    return { removed: record, operation: executed };
  }
}
