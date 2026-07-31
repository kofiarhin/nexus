import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubClient } from '../../server/integrations/github/githubClient.js';
import { VaultRepository } from '../../server/repositories/vaultRepository.js';
import { AuditService } from '../../server/services/auditService.js';
import { OperationService } from '../../server/services/operationService.js';
import { loadEnv } from '../../server/config/env.js';
import { createStores } from '../../server/stores/memoryStore.js';
import { hashPassword } from '../../server/services/authService.js';
import { createFakeGitHub } from '../helpers/fakeGitHub.js';

const ACTOR = { id: 'owner', email: 'owner@example.test' };
const REQUEST_ID = 'req-test';

const FILES = {
  'tasks/TASKS.md': '# Tasks\n\n## Open\n\n- [ ] First @id(tsk-1)\n',
  'knowledge/topic.md': '# Topic\n\nOriginal body.\n',
  'registry/PROJECTS.md': '| nexus | Nexus | active | projects/nexus/PROJECT.md | 2026-07-30 |'
};

function build({ destructive = false, autoApproveLowRisk = true, files = FILES } = {}) {
  const env = loadEnv({
    PORT: '5000',
    SESSION_SECRET: 'test-secret',
    OWNER_EMAIL: 'owner@example.test',
    OWNER_PASSWORD_HASH: hashPassword('a-sufficiently-long-password'),
    GITHUB_TOKEN: 'token',
    GITHUB_OWNER: 'kofiarhin',
    WRITE_OPERATIONS_ENABLED: 'true',
    DESTRUCTIVE_OPERATIONS_ENABLED: destructive ? 'true' : 'false',
    AUTO_APPROVE_LOW_RISK: autoApproveLowRisk ? 'true' : 'false',
    LOG_ENABLED: 'false'
  });

  const { fetchImpl, state } = createFakeGitHub({ files });
  const githubClient = new GitHubClient({
    token: env.githubToken,
    owner: env.githubOwner,
    repo: env.githubVaultRepo,
    branch: env.githubVaultBranch,
    fetchImpl
  });

  const vaultRepository = new VaultRepository({
    githubClient,
    readPaths: env.vaultReadPaths,
    writePaths: env.vaultWritePaths,
    searchMaxFiles: env.searchMaxFiles
  });

  const stores = createStores();
  const auditService = new AuditService({ store: stores.audit });
  const operationService = new OperationService({
    env,
    vaultRepository,
    auditService,
    operationStore: stores.operations,
    idempotencyStore: stores.idempotency
  });

  return { operationService, auditService, vaultRepository, vault: state, env };
}

describe('proposing an operation', () => {
  let context;
  beforeEach(() => {
    context = build();
  });

  it('computes a diff and the current revision without writing', async () => {
    const before = context.vault.read('knowledge/topic.md');
    const operation = await context.operationService.propose({
      actor: ACTOR,
      requestId: REQUEST_ID,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: '# Topic\n\nUpdated body.\n',
      reason: 'Edit'
    });

    expect(operation.status).toBe('proposed');
    expect(operation.risk).toBe('material');
    expect(operation.requiresApproval).toBe(true);
    expect(operation.diff).toContain('-Original body.');
    expect(operation.diff).toContain('+Updated body.');
    expect(operation.expectedSha).toEqual(expect.any(String));
    expect(context.vault.read('knowledge/topic.md')).toBe(before);
  });

  it('records a proposed audit event', async () => {
    const operation = await context.operationService.propose({
      actor: ACTOR,
      requestId: REQUEST_ID,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: 'x'
    });

    const events = context.auditService.list({ operationId: operation.id });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ result: 'proposed', action: 'replace', requestId: REQUEST_ID });
    expect(events[0].actor).toEqual({ id: 'owner', email: 'owner@example.test' });
  });

  it('refuses to create over an existing path', async () => {
    await expect(context.operationService.propose({
      actor: ACTOR,
      action: 'create',
      path: 'knowledge/topic.md',
      content: 'x'
    })).rejects.toMatchObject({ code: 'VAULT_FILE_EXISTS' });
  });

  it('rejects a path outside the write allowlist', async () => {
    await expect(context.operationService.propose({
      actor: ACTOR,
      action: 'replace',
      path: 'NEXUS.md',
      content: 'x'
    })).rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' });
  });

  it('detects a revision conflict at proposal time', async () => {
    const file = await context.vaultRepository.readText('knowledge/topic.md');
    context.vault.mutateBehind('knowledge/topic.md', '# Changed\n');

    await expect(context.operationService.propose({
      actor: ACTOR,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: 'x',
      expectedSha: file.revision
    })).rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
  });

  it('flags an append whose content is already present as a no-op', async () => {
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'append',
      path: 'tasks/TASKS.md',
      content: '- [ ] First @id(tsk-1)',
      underHeading: 'Open'
    });

    expect(operation.note).toMatch(/already present/i);
    expect(operation.diff).toBe('');
  });

  it('builds a reviewable diff for a restore', async () => {
    const original = await context.vaultRepository.readText('knowledge/topic.md');
    await context.vaultRepository.replaceText('knowledge/topic.md', '# Topic\n\nSecond.\n', original.revision, 'Change');
    const history = await context.vaultRepository.readHistory('knowledge/topic.md');

    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'restore',
      path: 'knowledge/topic.md',
      restoreRevision: history.revisions[1].revision
    });

    expect(operation.diff).toContain('+Original body.');
    expect(operation.diff).toContain('-Second.');
  });
});

describe('write and destructive feature flags', () => {
  it('refuses every mutation when writes are disabled', async () => {
    const env = loadEnv({ PORT: '5000', SESSION_SECRET: 'x', GITHUB_TOKEN: 't', GITHUB_OWNER: 'o' });
    const { fetchImpl } = createFakeGitHub({ files: FILES });
    const service = new OperationService({
      env,
      vaultRepository: new VaultRepository({
        githubClient: new GitHubClient({ token: 't', owner: 'o', repo: 'r', branch: 'main', fetchImpl }),
        readPaths: env.vaultReadPaths,
        writePaths: env.vaultWritePaths
      }),
      auditService: new AuditService({ store: createStores().audit }),
      operationStore: createStores().operations,
      idempotencyStore: createStores().idempotency
    });

    expect(service.allowedActions).toEqual([]);
    await expect(service.propose({ actor: ACTOR, action: 'append', path: 'tasks/TASKS.md', content: 'x' }))
      .rejects.toMatchObject({ code: 'VAULT_WRITE_DISABLED' });
  });

  it('excludes delete from the allowed actions unless destructive operations are enabled', () => {
    expect(build().operationService.allowedActions).not.toContain('delete');
    expect(build({ destructive: true }).operationService.allowedActions).toContain('delete');
  });

  it('refuses a delete proposal while destructive operations are disabled', async () => {
    await expect(build().operationService.propose({ actor: ACTOR, action: 'delete', path: 'tasks/TASKS.md' }))
      .rejects.toMatchObject({ code: 'OPERATION_NOT_ALLOWED' });
  });
});

describe('approval and execution', () => {
  it('refuses to execute a material operation that was never approved', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: 'new'
    });

    await expect(context.operationService.execute({ operationId: operation.id, actor: ACTOR }))
      .rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    expect(context.vault.read('knowledge/topic.md')).toBe(FILES['knowledge/topic.md']);
  });

  it('applies an approved operation, verifies by readback, and records the commit', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      requestId: REQUEST_ID,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: '# Topic\n\nApproved body.\n'
    });

    context.operationService.approve({ operationId: operation.id, actor: ACTOR, requestId: REQUEST_ID });
    const executed = await context.operationService.execute({ operationId: operation.id, actor: ACTOR, requestId: REQUEST_ID });

    expect(executed.status).toBe('succeeded');
    expect(executed.result.verified).toBe(true);
    expect(executed.result.commit).toEqual(expect.any(String));
    expect(context.vault.read('knowledge/topic.md')).toBe('# Topic\n\nApproved body.\n');

    const results = context.auditService.list({ operationId: operation.id }).map((event) => event.result);
    expect(results).toEqual(['succeeded', 'approved', 'proposed']);

    const success = context.auditService.list({ operationId: operation.id, result: 'succeeded' })[0];
    expect(success.commit).toBe(executed.result.commit);
    expect(success.approval.approvedBy.email).toBe(ACTOR.email);
    expect(success.beforeRevision).not.toBe(success.afterRevision);
  });

  it('combines approval and execution for a low-risk manual operation', async () => {
    const context = build();
    const { operation, executed } = await context.operationService.proposeAndMaybeExecute({
      actor: ACTOR,
      action: 'append',
      path: 'tasks/TASKS.md',
      content: '- [ ] Second @id(tsk-2)',
      underHeading: 'Open',
      source: 'manual'
    });

    expect(executed).toBe(true);
    expect(operation.status).toBe('succeeded');
    expect(context.vault.read('tasks/TASKS.md')).toContain('- [ ] Second @id(tsk-2)');
  });

  it('does not combine them when the policy disables it', async () => {
    const context = build({ autoApproveLowRisk: false });
    const { operation, executed } = await context.operationService.proposeAndMaybeExecute({
      actor: ACTOR,
      action: 'append',
      path: 'tasks/TASKS.md',
      content: '- [ ] Second',
      source: 'manual'
    });

    expect(executed).toBe(false);
    expect(operation.status).toBe('proposed');
  });

  it('never combines them for a conversational proposal', async () => {
    const context = build();
    const { executed, operation } = await context.operationService.proposeAndMaybeExecute({
      actor: ACTOR,
      action: 'append',
      path: 'tasks/TASKS.md',
      content: '- [ ] From chat',
      source: 'conversation'
    });

    expect(executed).toBe(false);
    expect(operation.status).toBe('proposed');
    expect(context.vault.read('tasks/TASKS.md')).not.toContain('From chat');
  });

  it('rejects an operation without touching the Vault', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: 'rejected content'
    });

    const rejected = context.operationService.reject({ operationId: operation.id, actor: ACTOR, reason: 'Not now' });

    expect(rejected.status).toBe('rejected');
    expect(context.vault.read('knowledge/topic.md')).toBe(FILES['knowledge/topic.md']);
    await expect(context.operationService.execute({ operationId: operation.id, actor: ACTOR }))
      .rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('cannot approve an operation twice', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: 'x'
    });
    context.operationService.approve({ operationId: operation.id, actor: ACTOR });
    expect(() => context.operationService.approve({ operationId: operation.id, actor: ACTOR }))
      .toThrow(/cannot be approved/i);
  });

  it('reports a missing operation as not found', async () => {
    await expect(build().operationService.execute({ operationId: 'op_missing', actor: ACTOR }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('optimistic concurrency', () => {
  it('marks the operation conflicted when the file changed after approval', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: '# Topic\n\nMine.\n'
    });
    context.operationService.approve({ operationId: operation.id, actor: ACTOR });

    context.vault.mutateBehind('knowledge/topic.md', '# Topic\n\nTheirs.\n');

    await expect(context.operationService.execute({ operationId: operation.id, actor: ACTOR }))
      .rejects.toMatchObject({ code: 'VAULT_CONFLICT' });

    expect(context.operationService.get(operation.id).status).toBe('conflicted');
    expect(context.vault.read('knowledge/topic.md')).toBe('# Topic\n\nTheirs.\n');

    const conflict = context.auditService.list({ operationId: operation.id, result: 'conflicted' })[0];
    expect(conflict.conflict).toMatchObject({ path: 'knowledge/topic.md' });
  });

  it('includes both revisions and recovery guidance in the conflict details', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'replace',
      path: 'knowledge/topic.md',
      content: 'mine'
    });
    context.operationService.approve({ operationId: operation.id, actor: ACTOR });
    context.vault.mutateBehind('knowledge/topic.md', 'theirs');

    const error = await context.operationService
      .execute({ operationId: operation.id, actor: ACTOR })
      .catch((thrown) => thrown);

    expect(error.details.expectedRevision).toEqual(expect.any(String));
    expect(error.details.currentRevision).toEqual(expect.any(String));
    expect(error.details.expectedRevision).not.toBe(error.details.currentRevision);
    expect(error.details.guidance).toMatch(/reload/i);
  });
});

describe('idempotency', () => {
  it('returns the original result for a repeated key', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'append',
      path: 'tasks/TASKS.md',
      content: '- [ ] Idempotent @id(tsk-i)',
      underHeading: 'Open'
    });

    const first = await context.operationService.execute({
      operationId: operation.id,
      actor: ACTOR,
      idempotencyKey: 'key-1'
    });
    const second = await context.operationService.execute({
      operationId: operation.id,
      actor: ACTOR,
      idempotencyKey: 'key-1'
    });

    expect(second.result.commit).toBe(first.result.commit);
    expect(context.vault.read('tasks/TASKS.md').match(/tsk-i/g)).toHaveLength(1);
  });

  it('rejects a key reused for a different operation', async () => {
    const context = build();
    const first = await context.operationService.propose({
      actor: ACTOR,
      action: 'append',
      path: 'tasks/TASKS.md',
      content: '- [ ] One',
      underHeading: 'Open'
    });
    await context.operationService.execute({ operationId: first.id, actor: ACTOR, idempotencyKey: 'shared' });

    const second = await context.operationService.propose({
      actor: ACTOR,
      action: 'append',
      path: 'tasks/TASKS.md',
      content: '- [ ] Two',
      underHeading: 'Open'
    });

    await expect(context.operationService.execute({
      operationId: second.id,
      actor: ACTOR,
      idempotencyKey: 'shared'
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});

describe('archive and delete', () => {
  it('archives by moving the document and verifying the source is gone', async () => {
    const context = build();
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'archive',
      path: 'knowledge/topic.md'
    });

    expect(operation.risk).toBe('material');
    context.operationService.approve({ operationId: operation.id, actor: ACTOR });
    const executed = await context.operationService.execute({ operationId: operation.id, actor: ACTOR });

    expect(executed.status).toBe('succeeded');
    expect(context.vault.has('knowledge/topic.md')).toBe(false);
    expect(context.vault.paths().some((path) => path.startsWith('archive/knowledge/'))).toBe(true);
  });

  it('requires explicit confirmation before a hard delete', async () => {
    const context = build({ destructive: true });
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'delete',
      path: 'knowledge/topic.md'
    });

    expect(operation.risk).toBe('destructive');
    context.operationService.approve({ operationId: operation.id, actor: ACTOR });

    await expect(context.operationService.execute({ operationId: operation.id, actor: ACTOR }))
      .rejects.toMatchObject({ code: 'DESTRUCTIVE_CONFIRMATION_REQUIRED' });
    expect(context.vault.has('knowledge/topic.md')).toBe(true);

    const executed = await context.operationService.execute({
      operationId: operation.id,
      actor: ACTOR,
      confirmDestructive: true
    });

    expect(executed.status).toBe('succeeded');
    expect(executed.result.verified).toBe(true);
    expect(context.vault.has('knowledge/topic.md')).toBe(false);
  });

  it('restores a previous revision and records the rollback relationship', async () => {
    const context = build();
    const original = await context.vaultRepository.readText('knowledge/topic.md');
    await context.vaultRepository.replaceText('knowledge/topic.md', '# Topic\n\nBad edit.\n', original.revision, 'Bad');

    const history = await context.vaultRepository.readHistory('knowledge/topic.md');
    const operation = await context.operationService.propose({
      actor: ACTOR,
      action: 'restore',
      path: 'knowledge/topic.md',
      restoreRevision: history.revisions[1].revision
    });

    context.operationService.approve({ operationId: operation.id, actor: ACTOR });
    await context.operationService.execute({ operationId: operation.id, actor: ACTOR });

    expect(context.vault.read('knowledge/topic.md')).toBe(original.content);
    const audit = context.auditService.list({ operationId: operation.id, result: 'succeeded' })[0];
    expect(audit.rollbackOf).toBe(history.revisions[1].revision);
  });
});

describe('audit redaction', () => {
  it('redacts credential-shaped values from recorded events', () => {
    const stores = createStores();
    const auditService = new AuditService({ store: stores.audit });
    const event = auditService.record({
      action: 'replace',
      result: 'failed',
      error: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz012345'
    });

    expect(event.error).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz012345');
    expect(event.error).toContain('[redacted]');
  });
});
