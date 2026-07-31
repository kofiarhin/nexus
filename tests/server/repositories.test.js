import { describe, expect, it } from 'vitest';
import { GitHubClient } from '../../server/integrations/github/githubClient.js';
import { VaultRepository } from '../../server/repositories/vaultRepository.js';
import { ProjectRepository } from '../../server/repositories/projectRepository.js';
import { BusinessRepository, parseBusinesses } from '../../server/repositories/businessRepository.js';
import { MemoryRepository, findConflicts, parseMemoryRecords, serializeMemory } from '../../server/repositories/memoryRepository.js';
import { parseInboxEntries, serializeInboxEntry } from '../../server/repositories/captureRepository.js';
import { createFakeGitHub } from '../helpers/fakeGitHub.js';
import { VAULT_FIXTURES } from '../helpers/testApp.js';

function createVault(files = VAULT_FIXTURES, options = {}) {
  const { fetchImpl, state } = createFakeGitHub({ files });
  const githubClient = new GitHubClient({
    token: 'token',
    owner: 'kofiarhin',
    repo: 'nexus-vault',
    branch: 'main',
    fetchImpl
  });

  const vaultRepository = new VaultRepository({
    githubClient,
    readPaths: options.readPaths ?? ['registry', 'projects', 'businesses', 'tasks', 'inbox', 'memory', 'knowledge', 'daily', 'archive', 'NEXUS.md'],
    writePaths: options.writePaths ?? ['projects', 'tasks', 'inbox', 'memory', 'knowledge', 'daily', 'archive'],
    searchMaxFiles: options.searchMaxFiles ?? 250
  });

  return { vaultRepository, githubClient, state };
}

describe('VaultRepository reads', () => {
  it('returns content with its revision and repository', async () => {
    const { vaultRepository } = createVault();
    const file = await vaultRepository.readText('registry/PROJECTS.md');

    expect(file.content).toContain('| nexus | Nexus |');
    expect(file.revision).toEqual(expect.any(String));
    expect(file.repository).toBe('kofiarhin/nexus-vault');
  });

  it('rejects a read outside the read allowlist', async () => {
    const { vaultRepository } = createVault();
    await expect(vaultRepository.readText('secrets/keys.md')).rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' });
  });

  it('rejects traversal before any request is made', async () => {
    const { vaultRepository, state } = createVault();
    await expect(vaultRepository.readText('projects/../../etc/passwd')).rejects.toMatchObject({
      code: 'PATH_NOT_ALLOWED'
    });
    expect(state.calls).toHaveLength(0);
  });

  it('returns null rather than throwing for a missing optional file', async () => {
    const { vaultRepository } = createVault();
    expect(await vaultRepository.readTextIfExists('tasks/MISSING.md')).toBeNull();
  });

  it('hides unreadable paths from a directory listing', async () => {
    const { vaultRepository } = createVault(
      { 'projects/a.md': '# A', 'secrets/b.md': '# B' },
      { readPaths: ['projects'] }
    );
    const entries = await vaultRepository.listDirectory('');
    expect(entries.map((entry) => entry.path)).toEqual(['projects']);
  });

  it('reports which paths are writable', () => {
    const { vaultRepository } = createVault();
    expect(vaultRepository.canWrite('tasks/TASKS.md')).toBe(true);
    expect(vaultRepository.canWrite('registry/PROJECTS.md')).toBe(false);
    expect(vaultRepository.canRead('registry/PROJECTS.md')).toBe(true);
  });
});

describe('VaultRepository search', () => {
  it('finds matches in document text with line context', async () => {
    const { vaultRepository } = createVault();
    const result = await vaultRepository.searchText('quarterly');

    expect(result.results[0].path).toBe('tasks/TASKS.md');
    expect(result.results[0].matches[0].text).toContain('quarterly');
  });

  it('scopes a search to a directory', async () => {
    const { vaultRepository } = createVault();
    const result = await vaultRepository.searchText('retrieval', { scope: 'knowledge' });
    expect(result.results.every((entry) => entry.path.startsWith('knowledge/'))).toBe(true);
  });

  it('bounds how many documents are scanned', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`knowledge/note-${index}.md`, '# Note\n\nneedle\n'])
    );
    const { vaultRepository } = createVault(files, { searchMaxFiles: 4, readPaths: ['knowledge'] });
    const result = await vaultRepository.searchText('needle', { limit: 20 });

    expect(result.scanned).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.results.length).toBeLessThanOrEqual(4);
  });

  it('rejects an empty query', async () => {
    const { vaultRepository } = createVault();
    await expect(vaultRepository.searchText('   ')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('VaultRepository writes', () => {
  it('creates a new file and records a commit', async () => {
    const { vaultRepository, state } = createVault();
    const result = await vaultRepository.createText('knowledge/new.md', '# New\n', 'Create note');

    expect(result.commit).toEqual(expect.any(String));
    expect(state.read('knowledge/new.md')).toBe('# New\n');
  });

  it('refuses to create over an existing file', async () => {
    const { vaultRepository } = createVault();
    await expect(vaultRepository.createText('tasks/TASKS.md', 'x', 'Create'))
      .rejects.toMatchObject({ code: 'VAULT_FILE_EXISTS' });
  });

  it('rejects a write outside the write allowlist', async () => {
    const { vaultRepository } = createVault();
    await expect(vaultRepository.createText('registry/NEW.md', 'x', 'Create'))
      .rejects.toMatchObject({ code: 'PATH_NOT_ALLOWED' });
  });

  it('detects a revision conflict on replace', async () => {
    const { vaultRepository, state } = createVault();
    const file = await vaultRepository.readText('tasks/TASKS.md');
    state.mutateBehind('tasks/TASKS.md', '# Changed elsewhere\n');

    await expect(vaultRepository.replaceText('tasks/TASKS.md', 'mine', file.revision, 'Replace'))
      .rejects.toMatchObject({ code: 'VAULT_CONFLICT' });
    expect(state.read('tasks/TASKS.md')).toBe('# Changed elsewhere\n');
  });

  it('requires a revision to replace or delete', async () => {
    const { vaultRepository } = createVault();
    await expect(vaultRepository.replaceText('tasks/TASKS.md', 'x', null, 'Replace'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(vaultRepository.deletePath('tasks/TASKS.md', null, 'Delete'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('moves a file by writing the destination before removing the source', async () => {
    const { vaultRepository, state } = createVault();
    const file = await vaultRepository.readText('knowledge/retrieval.md');
    const result = await vaultRepository.movePath('knowledge/retrieval.md', 'knowledge/moved.md', file.revision, 'Move');

    expect(result.previousPath).toBe('knowledge/retrieval.md');
    expect(state.has('knowledge/retrieval.md')).toBe(false);
    expect(state.read('knowledge/moved.md')).toBe(file.content);
  });

  it('refuses to move onto an existing destination', async () => {
    const { vaultRepository, state } = createVault();
    const file = await vaultRepository.readText('knowledge/retrieval.md');
    await expect(vaultRepository.movePath('knowledge/retrieval.md', 'tasks/TASKS.md', file.revision, 'Move'))
      .rejects.toMatchObject({ code: 'VAULT_FILE_EXISTS' });
    expect(state.has('knowledge/retrieval.md')).toBe(true);
  });

  it('archives to a dated path under archive/', async () => {
    const { vaultRepository, state } = createVault();
    const file = await vaultRepository.readText('knowledge/retrieval.md');
    const result = await vaultRepository.archivePath(
      'knowledge/retrieval.md',
      file.revision,
      'Archive',
      { now: new Date('2026-07-31T00:00:00Z') }
    );

    expect(result.path).toBe('archive/knowledge/retrieval.2026-07-31.md');
    expect(state.has('knowledge/retrieval.md')).toBe(false);
  });

  it('reads history and restores a previous revision', async () => {
    const { vaultRepository, state } = createVault();
    const original = await vaultRepository.readText('tasks/TASKS.md');
    await vaultRepository.replaceText('tasks/TASKS.md', '# Replaced\n', original.revision, 'Replace');

    const history = await vaultRepository.readHistory('tasks/TASKS.md');
    expect(history.revisions.length).toBeGreaterThanOrEqual(2);

    const current = await vaultRepository.readText('tasks/TASKS.md');
    await vaultRepository.restoreRevision(
      'tasks/TASKS.md',
      history.revisions[1].revision,
      current.revision,
      'Restore'
    );

    expect(state.read('tasks/TASKS.md')).toBe(original.content);
  });
});

describe('ProjectRepository', () => {
  it('returns a full project record from the registry and document', async () => {
    const { vaultRepository } = createVault();
    const project = await new ProjectRepository({ vaultRepository }).get('nexus');

    expect(project).toMatchObject({ id: 'nexus', name: 'Nexus', lifecycle: 'active' });
    expect(project.currentState).toContain('Foundation implemented');
    expect(project.roadmap).toEqual(['Verified read workspace', 'Operational core']);
    expect(project.openQuestions).toEqual(['Where should reports live?']);
    expect(project.sources.map((source) => source.path)).toEqual([
      'registry/PROJECTS.md',
      'projects/nexus/PROJECT.md'
    ]);
  });

  it('returns null for an unknown project', async () => {
    const { vaultRepository } = createVault();
    expect(await new ProjectRepository({ vaultRepository }).get('missing')).toBeNull();
  });

  it('still returns registry data when the project document is missing', async () => {
    const { vaultRepository } = createVault({
      'registry/PROJECTS.md': '| ghost | Ghost | active | projects/ghost/PROJECT.md | 2026-07-30 |'
    });
    const project = await new ProjectRepository({ vaultRepository }).get('ghost');

    expect(project.documentMissing).toBe(true);
    expect(project.name).toBe('Ghost');
  });
});

describe('parseBusinesses', () => {
  it('parses the structured registry format', () => {
    expect(parseBusinesses('| acme | Acme | active | businesses/acme/BUSINESS.md | 2026-07-30 |')).toEqual([
      {
        id: 'acme',
        name: 'Acme',
        status: 'active',
        path: 'businesses/acme/BUSINESS.md',
        summary: 'Status: active',
        updatedAt: '2026-07-30'
      }
    ]);
  });

  it('parses the linked registry format', () => {
    const [business] = parseBusinesses('| [Acme](businesses/acme/BUSINESS.md) | Design studio |');
    expect(business).toMatchObject({ id: 'acme', name: 'Acme', summary: 'Design studio' });
  });

  it('ignores rows without a document path', () => {
    expect(parseBusinesses('| Not a business | Ignored |')).toEqual([]);
  });

  it('returns an empty list without a registry file', async () => {
    const { vaultRepository } = createVault({ 'tasks/TASKS.md': '# Tasks\n' });
    const result = await new BusinessRepository({ vaultRepository }).list();

    expect(result.businesses).toEqual([]);
    expect(result.registered).toBe(false);
  });

  it('builds a full business record from its document', async () => {
    const { vaultRepository } = createVault();
    const business = await new BusinessRepository({ vaultRepository }).get('acme');

    expect(business).toMatchObject({ id: 'acme', name: 'Acme Studio', status: 'active' });
    expect(business.goals).toEqual(['Reach ten retained clients']);
    expect(business.risks).toEqual(['Client concentration']);
  });
});

describe('memory records', () => {
  it('parses and serializes a memory statement', () => {
    const [record] = parseMemoryRecords(
      '- Kofi prefers concise summaries @id(mem-1) @type(preference) @sources(a.md,b.md)',
      'memory/MEMORY.md'
    );

    expect(record).toMatchObject({
      id: 'mem-1',
      statement: 'Kofi prefers concise summaries',
      type: 'preference',
      sources: ['a.md', 'b.md']
    });

    expect(parseMemoryRecords(serializeMemory(record), 'memory/MEMORY.md')[0].statement).toBe(record.statement);
  });

  it('defaults an unrecognised classification to fact', () => {
    expect(parseMemoryRecords('- Something @type(nonsense)', 'memory/MEMORY.md')[0].type).toBe('fact');
  });

  it('flags a statement that overlaps an existing memory', async () => {
    const { vaultRepository } = createVault();
    const { records } = await new MemoryRepository({ vaultRepository }).list();

    expect(findConflicts(records, 'Kofi prefers concise summaries always')).toHaveLength(1);
    expect(findConflicts(records, 'Completely unrelated statement about invoicing')).toHaveLength(0);
  });
});

describe('inbox entries', () => {
  it('parses and serializes a captured entry', () => {
    const [entry] = parseInboxEntries('- An idea @id(inb-1) @kind(idea) @captured(2026-07-30)', 'inbox/INBOX.md');
    expect(entry).toMatchObject({ id: 'inb-1', content: 'An idea', kind: 'idea', status: 'open' });
    expect(serializeInboxEntry(entry)).toContain('@kind(idea)');
  });

  it('defaults an unrecognised kind to unclassified', () => {
    expect(parseInboxEntries('- Something @kind(weird)', 'inbox/INBOX.md')[0].kind).toBe('unclassified');
  });
});
