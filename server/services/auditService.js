import { newId } from '../utils/ids.js';
import { redact } from '../utils/redact.js';

/**
 * Operational audit trail (specification section 20).
 *
 * Audit records provide traceability alongside Git evidence; they never
 * replace it. Every field is redacted before storage so a failure message can
 * never carry a credential into the activity view.
 */
export class AuditService {
  constructor({ store, logger, now = () => new Date() }) {
    this.store = store;
    this.logger = logger;
    this.now = now;
  }

  record({
    requestId = null,
    actor = null,
    operationId = null,
    action,
    risk = null,
    path = null,
    destinationPath = null,
    beforeRevision = null,
    afterRevision = null,
    approval = null,
    commit = null,
    result,
    error = null,
    conflict = null,
    rollbackOf = null,
    source = 'manual'
  }) {
    const id = newId('aud');
    const event = redact({
      id,
      requestId,
      actor: actor ? { id: actor.id, email: actor.email } : null,
      operationId,
      action,
      risk,
      path,
      destinationPath,
      beforeRevision,
      afterRevision,
      approval,
      commit,
      result,
      error,
      conflict,
      rollbackOf,
      source,
      timestamp: this.now().toISOString()
    });

    this.store.set(id, event);
    this.logger?.info('audit.event', {
      operationId,
      action,
      risk,
      result,
      path,
      commit,
      requestId
    });

    return event;
  }

  list({ limit = 100, operationId = null, path = null, result = null } = {}) {
    return this.store.list({
      limit,
      filter: (event) => (operationId ? event.operationId === operationId : true)
        && (path ? event.path === path || event.destinationPath === path : true)
        && (result ? event.result === result : true)
    });
  }

  get(id) {
    return this.store.get(id);
  }
}
