import { describe, expect, it } from 'vitest';
import { createTestApp, destructiveEnabled, createPublicClient, writeEnabled } from '../helpers/testApp.js';

/** Proposes a change, approves it, then executes it. */
async function proposeApproveExecute(send, body, { confirmDestructive = false } = {}) {
  const proposal = await send('post', '/api/v1/operations/proposals').send(body);
  const { operation } = proposal.body.data;

  await send('post', `/api/v1/operations/${operation.id}/approve`).send({});
  const executed = await send('post', `/api/v1/operations/${operation.id}/execute`).send({ confirmDestructive });

  return { proposal, operation, executed };
}

describe('Vault reading', () => {
  it('returns the Vault tree with only readable documents', async () => {
    const { app } = createTestApp();
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/vault/tree');

    expect(response.status).toBe(200);
    const names = response.body.data.entries.map((entry) => entry.name);
    expect(names).toContain('projects');
    expect(names).toContain('tasks');
  });

  it('reads a document with its revision and writability', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/vault/files?path=tasks/TASKS.md');

    expect(response.status).toBe(200);
    expect(response.body.data.file.content).toContain('Review the quarterly plan');
    expect(response.body.data.file.revision).toEqual(expect.any(String));
    expect(response.body.data.file.writable).toBe(true);
  });

  it('rejects a traversal path in a query parameter', async () => {
    const { app } = createTestApp();
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/vault/files?path=../../etc/passwd');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses to read outside the allowlist', async () => {
    const { app } = createTestApp({ environment: { VAULT_READ_PATHS: 'projects' } });
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/vault/files?path=tasks/TASKS.md');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PATH_NOT_ALLOWED');
  });

  it('returns Git history for a document', async () => {
    const { app } = createTestApp();
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/vault/files/history?path=tasks/TASKS.md');

    expect(response.status).toBe(200);
    expect(response.body.data.revisions[0]).toMatchObject({ revision: expect.any(String), message: expect.any(String) });
  });

  it('runs a layered search without invoking any reasoning provider', async () => {
    const { app } = createTestApp();
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/search?q=quarterly');

    expect(response.status).toBe(200);
    expect(response.body.data.layers).toContain('text');
    expect(response.body.data.results[0].path).toBe('tasks/TASKS.md');
    expect(response.body.data.results[0].reason).toBeTruthy();
  });

  it('resolves a registered project by name in the registry layer', async () => {
    const { app } = createTestApp();
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/search?q=nexus');

    expect(response.body.data.layers).toContain('registry');
    expect(response.body.data.results.some((result) => result.entity?.type === 'project')).toBe(true);
  });
});

describe('Vault writes', () => {
  it('refuses every mutation while writes are disabled', async () => {
    const { app, vault } = createTestApp();
    const { send } = await createPublicClient(app);

    const response = await send('put', '/api/v1/vault/files').send({
      path: 'knowledge/retrieval.md',
      content: '# Changed'
    });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('VAULT_WRITE_DISABLED');
    expect(vault.read('knowledge/retrieval.md')).toContain('Deterministic retrieval');
  });

  it('creates a document through the approval pipeline', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const { executed } = await proposeApproveExecute(send, {
      action: 'create',
      path: 'knowledge/new-note.md',
      content: '# New note\n\nBody.\n',
      reason: 'Create a knowledge note'
    });

    expect(executed.status).toBe(200);
    expect(executed.body.data.operation.status).toBe('succeeded');
    expect(executed.body.data.operation.result.verified).toBe(true);
    expect(executed.body.data.operation.result.commit).toEqual(expect.any(String));
    expect(vault.read('knowledge/new-note.md')).toBe('# New note\n\nBody.\n');
  });

  it('refuses to create over an existing document', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const response = await send('post', '/api/v1/vault/files').send({
      path: 'knowledge/retrieval.md',
      content: '# Overwrite attempt'
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('VAULT_FILE_EXISTS');
  });

  it('shows a diff on a replace proposal and writes nothing until executed', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await createPublicClient(app);

    const file = await agent.get('/api/v1/vault/files?path=knowledge/retrieval.md');
    const before = vault.read('knowledge/retrieval.md');

    const proposal = await send('put', '/api/v1/vault/files').send({
      path: 'knowledge/retrieval.md',
      content: '# Retrieval\n\nRewritten.\n',
      expectedSha: file.body.data.file.revision
    });

    expect(proposal.status).toBe(200);
    expect(proposal.body.data.executed).toBe(false);
    expect(proposal.body.data.operation.status).toBe('proposed');
    expect(proposal.body.data.operation.risk).toBe('material');
    expect(proposal.body.data.operation.diff).toContain('+Rewritten.');
    expect(vault.read('knowledge/retrieval.md')).toBe(before);
  });

  it('rejects a proposal without changing the Vault', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const before = vault.read('knowledge/retrieval.md');
    const proposal = await send('put', '/api/v1/vault/files').send({
      path: 'knowledge/retrieval.md',
      content: '# Rejected change'
    });

    const rejected = await send('post', `/api/v1/operations/${proposal.body.data.operation.id}/reject`)
      .send({ reason: 'Not wanted' });

    expect(rejected.body.data.operation.status).toBe('rejected');
    expect(vault.read('knowledge/retrieval.md')).toBe(before);
  });

  it('returns a conflict when the document changed after the proposal', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const proposal = await send('put', '/api/v1/vault/files').send({
      path: 'knowledge/retrieval.md',
      content: '# Mine\n'
    });
    const { operation } = proposal.body.data;

    await send('post', `/api/v1/operations/${operation.id}/approve`).send({});
    vault.mutateBehind('knowledge/retrieval.md', '# Theirs\n');

    const executed = await send('post', `/api/v1/operations/${operation.id}/execute`).send({});

    expect(executed.status).toBe(409);
    expect(executed.body.error.code).toBe('VAULT_CONFLICT');
    expect(executed.body.error.details.currentRevision).toEqual(expect.any(String));
    expect(vault.read('knowledge/retrieval.md')).toBe('# Theirs\n');
  });

  it('appends without duplicating content on retry', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const first = await send('post', '/api/v1/vault/files/append').send({
      path: 'inbox/INBOX.md',
      content: '- A retried capture',
      underHeading: 'Captured'
    });
    expect(first.body.data.executed).toBe(true);

    const second = await send('post', '/api/v1/vault/files/append').send({
      path: 'inbox/INBOX.md',
      content: '- A retried capture',
      underHeading: 'Captured'
    });

    expect(second.body.data.executed).toBe(false);
    expect(second.body.data.operation.note).toMatch(/already present/i);
    expect(vault.read('inbox/INBOX.md').match(/A retried capture/g)).toHaveLength(1);
  });

  it('moves a document after approval', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const { executed } = await proposeApproveExecute(send, {
      action: 'move',
      path: 'knowledge/retrieval.md',
      destinationPath: 'knowledge/deterministic-retrieval.md'
    });

    expect(executed.body.data.operation.status).toBe('succeeded');
    expect(vault.has('knowledge/retrieval.md')).toBe(false);
    expect(vault.has('knowledge/deterministic-retrieval.md')).toBe(true);
  });

  it('archives a document to a dated archive path', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const { executed } = await proposeApproveExecute(send, {
      action: 'archive',
      path: 'knowledge/retrieval.md'
    });

    expect(executed.body.data.operation.status).toBe('succeeded');
    expect(vault.has('knowledge/retrieval.md')).toBe(false);
    expect(vault.paths().some((path) => path.startsWith('archive/knowledge/retrieval.'))).toBe(true);
  });

  it('refuses a hard delete while destructive operations are disabled', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await createPublicClient(app);

    const response = await send('delete', '/api/v1/vault/files').send({ path: 'knowledge/retrieval.md' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('OPERATION_NOT_ALLOWED');
    expect(vault.has('knowledge/retrieval.md')).toBe(true);
  });

  it('requires explicit confirmation for a hard delete', async () => {
    const { app, vault } = createTestApp({ environment: destructiveEnabled() });
    const { send } = await createPublicClient(app);

    const proposal = await send('delete', '/api/v1/vault/files').send({ path: 'knowledge/retrieval.md' });
    const { operation } = proposal.body.data;

    expect(operation.risk).toBe('destructive');
    expect(proposal.body.data.executed).toBe(false);

    await send('post', `/api/v1/operations/${operation.id}/approve`).send({});

    const unconfirmed = await send('post', `/api/v1/operations/${operation.id}/execute`).send({});
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error.code).toBe('DESTRUCTIVE_CONFIRMATION_REQUIRED');
    expect(vault.has('knowledge/retrieval.md')).toBe(true);

    const confirmed = await send('post', `/api/v1/operations/${operation.id}/execute`)
      .send({ confirmDestructive: true });

    expect(confirmed.status).toBe(200);
    expect(vault.has('knowledge/retrieval.md')).toBe(false);
  });

  it('restores a previous revision', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await createPublicClient(app);

    const original = vault.read('knowledge/retrieval.md');
    const file = await agent.get('/api/v1/vault/files?path=knowledge/retrieval.md');

    await proposeApproveExecute(send, {
      action: 'replace',
      path: 'knowledge/retrieval.md',
      content: '# Retrieval\n\nBad edit.\n',
      expectedSha: file.body.data.file.revision
    });
    expect(vault.read('knowledge/retrieval.md')).toContain('Bad edit');

    const history = await agent.get('/api/v1/vault/files/history?path=knowledge/retrieval.md');
    const previous = history.body.data.revisions[1].revision;

    const restore = await send('post', '/api/v1/vault/files/restore').send({
      path: 'knowledge/retrieval.md',
      revision: previous
    });
    const restoreId = restore.body.data.operation.id;

    await send('post', `/api/v1/operations/${restoreId}/approve`).send({});
    const executed = await send('post', `/api/v1/operations/${restoreId}/execute`).send({});

    expect(executed.body.data.operation.status).toBe('succeeded');
    expect(vault.read('knowledge/retrieval.md')).toBe(original);
  });
});

describe('activity and audit', () => {
  it('records the full proposal-to-execution trail with Git evidence', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await createPublicClient(app);

    const { operation, executed } = await proposeApproveExecute(send, {
      action: 'create',
      path: 'knowledge/audited.md',
      content: '# Audited\n'
    });

    const activity = await agent.get(`/api/v1/activity?operationId=${operation.id}`);
    const results = activity.body.data.events.map((event) => event.result);

    expect(results).toEqual(['succeeded', 'approved', 'proposed']);

    const success = activity.body.data.events[0];
    expect(success).toMatchObject({
      action: 'create',
      path: 'knowledge/audited.md',
      risk: 'material',
      commit: executed.body.data.operation.result.commit
    });
    expect(success.actor).toBeNull();
    expect(success.approval.approvedBy).toBeNull();
    expect(success.requestId).toEqual(expect.any(String));
  });

  it('records a rejection and never leaks the Vault token', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await createPublicClient(app);

    const proposal = await send('put', '/api/v1/vault/files').send({
      path: 'knowledge/retrieval.md',
      content: '# Nope'
    });
    await send('post', `/api/v1/operations/${proposal.body.data.operation.id}/reject`).send({ reason: 'No' });

    const activity = await agent.get('/api/v1/activity');
    expect(activity.body.data.events.some((event) => event.result === 'rejected')).toBe(true);
    expect(JSON.stringify(activity.body)).not.toContain('test-token-value');
  });

  it('returns the operation with its audit trail', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await createPublicClient(app);

    const proposal = await send('post', '/api/v1/operations/proposals').send({
      action: 'replace',
      path: 'knowledge/retrieval.md',
      content: '# Later'
    });
    const response = await agent.get(`/api/v1/operations/${proposal.body.data.operation.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.operation.status).toBe('proposed');
    expect(response.body.data.audit).toHaveLength(1);
  });

  it('reports an unknown operation as not found', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent } = await createPublicClient(app);

    const response = await agent.get('/api/v1/operations/op_does_not_exist');
    expect(response.status).toBe(404);
  });
});
