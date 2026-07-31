import {
  canAutoExecute,
  classifyRisk,
  requiresDestructiveConfirmation
} from '../config/policy.js';
import { appError } from '../utils/errors.js';
import { createUnifiedDiff, diffStats } from '../utils/diff.js';
import { hashPayload, newId } from '../utils/ids.js';
import { appendLine } from '../utils/markdown.js';
import { archiveDestination, normalizeVaultPath } from '../utils/paths.js';

const MUTATING_ACTIONS = new Set(['create', 'replace', 'patch', 'append', 'move', 'archive', 'delete', 'restore']);

/**
 * The operation proposal and mutation pipeline (specification sections 14–16).
 *
 * A proposal is never execution evidence. Proposing computes the before/after
 * diff and risk; executing re-reads the target, applies with the expected
 * revision, verifies by readback, and records Git evidence. Model-generated and
 * manual operations share this one path.
 */
export class OperationService {
  constructor({ env, vaultRepository, auditService, operationStore, idempotencyStore, logger, now = () => new Date() }) {
    this.env = env;
    this.vaultRepository = vaultRepository;
    this.auditService = auditService;
    this.operations = operationStore;
    this.idempotency = idempotencyStore;
    this.logger = logger;
    this.now = now;
  }

  get allowedActions() {
    if (!this.env.writeOperationsEnabled) return [];
    const actions = ['create', 'replace', 'patch', 'append', 'move', 'archive', 'restore'];
    if (this.env.destructiveOperationsEnabled) actions.push('delete');
    return actions;
  }

  assertWritesEnabled() {
    if (!this.env.writeOperationsEnabled) {
      throw appError(
        'VAULT_WRITE_DISABLED',
        'Vault write operations are disabled. Enable WRITE_OPERATIONS_ENABLED to allow mutations.'
      );
    }
  }

  assertActionAllowed(action) {
    if (!MUTATING_ACTIONS.has(action)) {
      throw appError('OPERATION_NOT_ALLOWED', `Unsupported operation: ${action}`);
    }
    this.assertWritesEnabled();
    if (action === 'delete' && !this.env.destructiveOperationsEnabled) {
      throw appError(
        'OPERATION_NOT_ALLOWED',
        'Destructive operations are disabled. Archive is the default removal method.'
      );
    }
  }

  /**
   * Builds the proposed content for an action without writing anything.
   * Returns `{ before, after, targetPath, currentRevision, note }`.
   */
  async #resolveChange({ action, path, destinationPath, content, underHeading, revision, restoreRevision }) {
    const target = this.vaultRepository.resolveWritePath(path);

    if (action === 'create') {
      const existing = await this.vaultRepository.readTextIfExists(target);
      if (existing) {
        throw appError('VAULT_FILE_EXISTS', `A Vault file already exists at ${target}`, { path: target });
      }
      return { before: '', after: content ?? '', targetPath: target, currentRevision: null };
    }

    const current = await this.vaultRepository.readText(target);

    if (revision && current.revision !== revision) {
      throw appError('VAULT_CONFLICT', 'The Vault file changed since it was read', {
        path: target,
        expectedRevision: revision,
        currentRevision: current.revision,
        guidance: 'Reload the document, compare the differences, and repropose the change.'
      });
    }

    if (action === 'replace' || action === 'patch') {
      return { before: current.content, after: content ?? '', targetPath: target, currentRevision: current.revision };
    }

    if (action === 'append') {
      // Append is retry-safe: an identical line already present is a no-op.
      const appended = appendLine(current.content, String(content ?? '').trim(), { underHeading });
      return {
        before: current.content,
        after: appended.content,
        targetPath: target,
        currentRevision: current.revision,
        note: appended.changed ? null : 'The appended content is already present; no change is required.'
      };
    }

    if (action === 'move') {
      const destination = this.vaultRepository.resolveWritePath(
        destinationPath ?? (() => {
          throw appError('VALIDATION_ERROR', 'A destination path is required to move a Vault file');
        })()
      );
      return {
        before: current.content,
        after: current.content,
        targetPath: target,
        destination,
        currentRevision: current.revision
      };
    }

    if (action === 'archive') {
      const destination = this.vaultRepository.resolveWritePath(
        destinationPath ?? archiveDestination(target, this.now())
      );
      return {
        before: current.content,
        after: current.content,
        targetPath: target,
        destination,
        currentRevision: current.revision
      };
    }

    if (action === 'delete') {
      return { before: current.content, after: '', targetPath: target, currentRevision: current.revision };
    }

    if (action === 'restore') {
      if (!restoreRevision) {
        throw appError('VALIDATION_ERROR', 'A revision is required to restore a Vault file');
      }
      // Reading the historical content up front makes the restore reviewable
      // as an ordinary before/after diff.
      const historical = await this.vaultRepository.readText(target, restoreRevision);
      return {
        before: current.content,
        after: historical.content,
        targetPath: target,
        currentRevision: current.revision
      };
    }

    throw appError('OPERATION_NOT_ALLOWED', `Unsupported operation: ${action}`);
  }

  /**
   * Creates an operation proposal.
   * `source` is 'manual' or 'conversation'; only low-risk manual operations may
   * combine approval and execution when policy allows it.
   */
  async propose({
    actor,
    requestId,
    action,
    path,
    destinationPath = null,
    content = null,
    expectedSha = null,
    restoreRevision = null,
    underHeading = null,
    reason = 'Manual operation',
    message = null,
    sources = [],
    source = 'manual',
    conversationId = null
  }) {
    this.assertActionAllowed(action);

    const normalizedPath = normalizeVaultPath(path);
    const change = await this.#resolveChange({
      action,
      path: normalizedPath,
      destinationPath,
      content,
      underHeading,
      revision: expectedSha,
      restoreRevision
    });

    const risk = classifyRisk({ action, path: change.targetPath });
    const isContentChange = change.after !== null && action !== 'move' && action !== 'archive';

    const operation = {
      id: newId('op'),
      action,
      path: change.targetPath,
      destinationPath: change.destination ?? destinationPath ?? null,
      expectedSha: change.currentRevision,
      restoreRevision,
      underHeading,
      reason,
      message: message ?? `${action} ${change.targetPath}`,
      before: change.before,
      after: change.after,
      diff: isContentChange
        ? createUnifiedDiff(change.before, change.after, {
          fromPath: `${change.targetPath}@${change.currentRevision?.slice(0, 7) ?? 'new'}`,
          toPath: `${change.targetPath}@proposed`
        })
        : '',
      stats: isContentChange ? diffStats(change.before, change.after) : null,
      risk,
      sources,
      status: 'proposed',
      source,
      conversationId,
      note: change.note ?? null,
      requiresApproval: risk !== 'low',
      requiresDestructiveConfirmation: requiresDestructiveConfirmation(risk),
      actor: actor ? { id: actor.id, email: actor.email } : null,
      requestId,
      approval: null,
      result: null,
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };

    this.operations.set(operation.id, operation);

    this.auditService.record({
      requestId,
      actor,
      operationId: operation.id,
      action,
      risk,
      path: operation.path,
      destinationPath: operation.destinationPath,
      beforeRevision: operation.expectedSha,
      result: 'proposed',
      source
    });

    return operation;
  }

  get(operationId) {
    return this.operations.get(operationId);
  }

  list({ limit = 50, status = null } = {}) {
    return this.operations.list({
      limit,
      filter: (operation) => (status ? operation.status === status : true)
    });
  }

  #requireOperation(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation) {
      throw appError('NOT_FOUND', 'Operation not found');
    }
    return operation;
  }

  approve({ operationId, actor, requestId }) {
    const operation = this.#requireOperation(operationId);

    if (operation.status !== 'proposed') {
      throw appError('CONFLICT', `Operation cannot be approved from status "${operation.status}"`, {
        status: operation.status
      });
    }

    const approval = {
      approvedBy: actor ? { id: actor.id, email: actor.email } : null,
      approvedAt: this.now().toISOString(),
      requestId
    };

    const updated = this.operations.update(operationId, { status: 'approved', approval });

    this.auditService.record({
      requestId,
      actor,
      operationId,
      action: operation.action,
      risk: operation.risk,
      path: operation.path,
      destinationPath: operation.destinationPath,
      approval,
      result: 'approved',
      source: operation.source
    });

    return updated;
  }

  reject({ operationId, actor, requestId, reason }) {
    const operation = this.#requireOperation(operationId);

    if (!['proposed', 'approved'].includes(operation.status)) {
      throw appError('CONFLICT', `Operation cannot be rejected from status "${operation.status}"`, {
        status: operation.status
      });
    }

    const updated = this.operations.update(operationId, {
      status: 'rejected',
      result: { rejectedBy: actor?.email ?? null, reason, rejectedAt: this.now().toISOString() }
    });

    this.auditService.record({
      requestId,
      actor,
      operationId,
      action: operation.action,
      risk: operation.risk,
      path: operation.path,
      result: 'rejected',
      error: reason,
      source: operation.source
    });

    return updated;
  }

  /**
   * Executes an approved operation.
   * Re-reads the target immediately before writing, applies with optimistic
   * concurrency, verifies by readback, and records the commit.
   */
  async execute({ operationId, actor, requestId, confirmDestructive = false, idempotencyKey = null }) {
    const operation = this.#requireOperation(operationId);
    this.assertActionAllowed(operation.action);

    if (operation.status === 'succeeded') {
      // Re-executing a completed operation returns the original result.
      return operation;
    }

    if (operation.requiresApproval && operation.status !== 'approved') {
      throw appError('APPROVAL_REQUIRED', 'This operation must be approved before it can execute', {
        operationId,
        risk: operation.risk,
        status: operation.status
      });
    }

    if (!operation.requiresApproval && !['proposed', 'approved'].includes(operation.status)) {
      throw appError('CONFLICT', `Operation cannot execute from status "${operation.status}"`, {
        status: operation.status
      });
    }

    if (requiresDestructiveConfirmation(operation.risk) && confirmDestructive !== true) {
      throw appError(
        'DESTRUCTIVE_CONFIRMATION_REQUIRED',
        'This operation permanently removes Vault content and requires explicit confirmation',
        { operationId, path: operation.path }
      );
    }

    if (idempotencyKey) {
      const existing = this.idempotency.get(idempotencyKey);
      const fingerprint = hashPayload({ operationId, action: operation.action, path: operation.path });
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw appError('IDEMPOTENCY_CONFLICT', 'This idempotency key was used for a different operation');
        }
        return existing.result;
      }
    }

    this.operations.update(operationId, { status: 'executing' });

    try {
      const applied = await this.#apply(operation);
      const verification = await this.#verify(operation, applied);

      const succeeded = this.operations.update(operationId, {
        status: 'succeeded',
        result: {
          commit: applied.commit,
          revision: applied.revision,
          path: applied.path,
          previousPath: applied.previousPath ?? null,
          verified: verification.verified,
          verifiedAt: this.now().toISOString()
        }
      });

      this.auditService.record({
        requestId,
        actor,
        operationId,
        action: operation.action,
        risk: operation.risk,
        path: operation.path,
        destinationPath: applied.path !== operation.path ? applied.path : operation.destinationPath,
        beforeRevision: operation.expectedSha,
        afterRevision: applied.revision,
        approval: operation.approval,
        commit: applied.commit,
        result: verification.verified ? 'succeeded' : 'succeeded-unverified',
        rollbackOf: operation.action === 'restore' ? operation.restoreRevision : null,
        source: operation.source
      });

      if (idempotencyKey) {
        this.idempotency.set(idempotencyKey, {
          fingerprint: hashPayload({ operationId, action: operation.action, path: operation.path }),
          result: succeeded
        });
      }

      return succeeded;
    } catch (error) {
      const conflicted = error?.code === 'VAULT_CONFLICT';
      const failed = this.operations.update(operationId, {
        status: conflicted ? 'conflicted' : 'failed',
        result: { code: error?.code ?? 'INTERNAL_ERROR', message: error?.expose ? error.message : 'Operation failed' }
      });

      this.auditService.record({
        requestId,
        actor,
        operationId,
        action: operation.action,
        risk: operation.risk,
        path: operation.path,
        destinationPath: operation.destinationPath,
        beforeRevision: operation.expectedSha,
        approval: operation.approval,
        result: conflicted ? 'conflicted' : 'failed',
        error: error?.expose ? error.message : 'Operation failed',
        conflict: conflicted ? error.details ?? null : null,
        source: operation.source
      });

      // The stored status is part of the failure evidence; surface the error.
      error.operation = failed;
      throw error;
    }
  }

  async #apply(operation) {
    const { action, path, after, expectedSha, message } = operation;

    if (action === 'create') {
      return this.vaultRepository.createText(path, after, message);
    }
    if (action === 'replace' || action === 'patch' || action === 'append') {
      // Re-read immediately before writing so a change since proposal is caught.
      const current = await this.vaultRepository.readText(path);
      if (expectedSha && current.revision !== expectedSha) {
        throw appError('VAULT_CONFLICT', 'The Vault file changed since it was proposed', {
          path,
          expectedRevision: expectedSha,
          currentRevision: current.revision,
          guidance: 'Reload the document, compare the differences, and repropose the change.'
        });
      }
      return this.vaultRepository.replaceText(path, after, current.revision, message);
    }
    if (action === 'move') {
      return this.vaultRepository.movePath(path, operation.destinationPath, expectedSha, message);
    }
    if (action === 'archive') {
      return this.vaultRepository.movePath(path, operation.destinationPath, expectedSha, message);
    }
    if (action === 'delete') {
      const current = await this.vaultRepository.readText(path);
      if (expectedSha && current.revision !== expectedSha) {
        throw appError('VAULT_CONFLICT', 'The Vault file changed since it was proposed', {
          path,
          expectedRevision: expectedSha,
          currentRevision: current.revision
        });
      }
      return this.vaultRepository.deletePath(path, current.revision, message);
    }
    if (action === 'restore') {
      const current = await this.vaultRepository.readText(path);
      if (expectedSha && current.revision !== expectedSha) {
        throw appError('VAULT_CONFLICT', 'The Vault file changed since it was proposed', {
          path,
          expectedRevision: expectedSha,
          currentRevision: current.revision
        });
      }
      return this.vaultRepository.replaceText(path, after, current.revision, message);
    }

    throw appError('OPERATION_NOT_ALLOWED', `Unsupported operation: ${action}`);
  }

  /** Confirms the write landed by reading the file back from the Vault. */
  async #verify(operation, applied) {
    if (operation.action === 'delete') {
      const remaining = await this.vaultRepository.readTextIfExists(operation.path);
      return { verified: remaining === null };
    }

    const readback = await this.vaultRepository.readTextIfExists(applied.path);
    if (!readback) return { verified: false };

    if (operation.action === 'move' || operation.action === 'archive') {
      const sourceRemoved = await this.vaultRepository.readTextIfExists(operation.path);
      return { verified: sourceRemoved === null };
    }

    if (operation.after === null) return { verified: true };
    return { verified: readback.content === operation.after };
  }

  /**
   * Convenience path for manual operations: propose, then execute immediately
   * when policy allows approval and execution to be combined.
   */
  async proposeAndMaybeExecute(input) {
    const operation = await this.propose(input);

    const autoExecute = canAutoExecute({
      risk: operation.risk,
      source: operation.source,
      autoApproveLowRisk: this.env.autoApproveLowRisk
    });

    if (!autoExecute || input.approve === false) {
      return { operation, executed: false };
    }

    if (operation.note) {
      // Nothing would change; leave the proposal recorded without a write.
      return { operation, executed: false };
    }

    const executed = await this.execute({
      operationId: operation.id,
      actor: input.actor,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey
    });

    return { operation: executed, executed: true };
  }
}
