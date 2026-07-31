import request from 'supertest';
import { createApp } from '../../server/app.js';
import { createFakeGitHub } from './fakeGitHub.js';

export const VAULT_FIXTURES = {
  'NEXUS.md': '# Nexus workspace rules\n\nDeterministic retrieval happens before reasoning.\n',
  'registry/PROJECTS.md': [
    '# Projects',
    '',
    '| ID | Name | Status | Path | Updated |',
    '| --- | --- | --- | --- | --- |',
    '| nexus | Nexus | active | projects/nexus/PROJECT.md | 2026-07-30 |',
    ''
  ].join('\n'),
  'registry/BUSINESSES.md': [
    '# Businesses',
    '',
    '| ID | Name | Status | Path | Updated |',
    '| --- | --- | --- | --- | --- |',
    '| acme | Acme Studio | active | businesses/acme/BUSINESS.md | 2026-07-30 |',
    ''
  ].join('\n'),
  'projects/nexus/PROJECT.md': [
    '---',
    'name: Nexus',
    'lifecycle: active',
    'updatedAt: 2026-07-30',
    '---',
    '',
    '# Nexus',
    '',
    '## Current state',
    '',
    'Foundation implemented.',
    '',
    '## Current focus',
    '',
    'Command center build-out.',
    '',
    '## Roadmap',
    '',
    '- Verified read workspace',
    '- Operational core',
    '',
    '## Decisions',
    '',
    '- Markdown stays canonical',
    '',
    '## Assumptions',
    '',
    '- The Vault is private',
    '',
    '## Open questions',
    '',
    '- Where should reports live?',
    ''
  ].join('\n'),
  'projects/nexus/TASKS.md': [
    '# Nexus tasks',
    '',
    '## Open',
    '',
    '- [ ] Wire the project detail page @id(tsk-project) @priority(high) @due(2026-07-01) @project(nexus)',
    ''
  ].join('\n'),
  'businesses/acme/BUSINESS.md': [
    '---',
    'name: Acme Studio',
    'status: active',
    '---',
    '',
    '# Acme Studio',
    '',
    '## Purpose',
    '',
    'Design services.',
    '',
    '## Goals',
    '',
    '- Reach ten retained clients',
    '',
    '## Metrics',
    '',
    '- Monthly recurring revenue',
    '',
    '## Risks',
    '',
    '- Client concentration',
    ''
  ].join('\n'),
  'tasks/TASKS.md': [
    '# Tasks',
    '',
    '## Open',
    '',
    '- [ ] Review the quarterly plan @id(tsk-review) @priority(high) @due(2026-07-31) @business(acme)',
    '- [ ] Unannotated legacy task',
    '- [x] Ship the foundation @id(tsk-shipped) @status(done) @completed(2026-07-30)',
    ''
  ].join('\n'),
  'inbox/INBOX.md': '# Inbox\n\n## Captured\n\n- An existing captured idea @id(inb-existing) @kind(idea)\n',
  'memory/MEMORY.md': '# Long-term memory\n\n## Records\n\n- Kofi prefers concise summaries @id(mem-style) @type(preference)\n',
  'knowledge/retrieval.md': '# Retrieval\n\nDeterministic retrieval precedes reasoning. See [[memory]].\n',
  'daily/2026-07-30.md': '# 2026-07-30\n\n## Plan\n\n- Draft the specification\n\n## Notes\n\nSteady progress.\n'
};

const BASE_ENVIRONMENT = {
  PORT: '5000',
  NODE_ENV: 'test',
  LOG_ENABLED: 'false',
  CLIENT_URL: 'http://localhost:5173',
  GITHUB_TOKEN: 'test-token-value',
  GITHUB_OWNER: 'kofiarhin',
  GITHUB_VAULT_REPO: 'nexus-vault',
  GITHUB_VAULT_BRANCH: 'main'
};

/**
 * Builds an app wired to the in-memory Vault.
 * `now` is fixed so date-dependent planning and task views are deterministic.
 */
export function createTestApp({
  files = VAULT_FIXTURES,
  environment = {},
  aiFetchImpl,
  now = () => new Date('2026-07-31T09:00:00.000Z')
} = {}) {
  const { fetchImpl, state } = createFakeGitHub({ files });

  const app = createApp({
    environment: {
      ...BASE_ENVIRONMENT,
      ...environment
    },
    fetchImpl,
    aiFetchImpl,
    now
  });

  return { app, vault: state, agent: request.agent(app) };
}

/** Returns a Supertest agent and mutation helper for the public MVP API. */
export async function createPublicClient(app) {
  const agent = request.agent(app);
  return {
    agent,
    send: (method, path) => agent[method](path)
  };
}

/** Environment that enables writes, and optionally destructive operations. */
export const writeEnabled = (extra = {}) => ({
  WRITE_OPERATIONS_ENABLED: 'true',
  ...extra
});

export const destructiveEnabled = () => writeEnabled({ DESTRUCTIVE_OPERATIONS_ENABLED: 'true' });
