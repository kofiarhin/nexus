/**
 * Process-scoped operational stores.
 *
 * Operations, audit events, conversations, and idempotency keys are runtime
 * traceability, not canonical knowledge: the Vault and Git history remain the
 * source of truth (specification section 20). Records are therefore held in
 * memory and bounded, and a restart clears them.
 */

const DEFAULT_LIMIT = 500;

export class RecordStore {
  constructor({ limit = DEFAULT_LIMIT } = {}) {
    this.limit = limit;
    this.records = new Map();
  }

  set(id, record) {
    this.records.set(id, record);
    this.#trim();
    return record;
  }

  get(id) {
    return this.records.get(id) ?? null;
  }

  update(id, changes) {
    const existing = this.records.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...changes, updatedAt: new Date().toISOString() };
    this.records.set(id, updated);
    return updated;
  }

  delete(id) {
    return this.records.delete(id);
  }

  /** Newest first. */
  list({ limit = 100, filter } = {}) {
    const all = [...this.records.values()].reverse();
    const filtered = typeof filter === 'function' ? all.filter(filter) : all;
    return filtered.slice(0, limit);
  }

  get size() {
    return this.records.size;
  }

  #trim() {
    while (this.records.size > this.limit) {
      const oldest = this.records.keys().next();
      if (oldest.done) break;
      this.records.delete(oldest.value);
    }
  }
}

/** Idempotency keys with a time-to-live, so a retry returns the first result. */
export class IdempotencyStore {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, limit = 500, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.limit = limit;
    this.now = now;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(key, { fingerprint, result }) {
    this.entries.set(key, { fingerprint, result, storedAt: this.now() });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return result;
  }
}

export function createStores(options = {}) {
  return {
    operations: new RecordStore({ limit: options.operationLimit ?? 500 }),
    audit: new RecordStore({ limit: options.auditLimit ?? 1000 }),
    conversations: new RecordStore({ limit: options.conversationLimit ?? 100 }),
    memoryProposals: new RecordStore({ limit: options.memoryProposalLimit ?? 200 }),
    idempotency: new IdempotencyStore(options.idempotency)
  };
}
