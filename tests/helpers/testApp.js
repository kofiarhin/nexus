import request from 'supertest';
import { createApp } from '../../server/app.js';
import { hashPassword } from '../../server/services/authService.js';
import { createFakeGitHub } from './fakeGitHub.js';

export const OWNER_EMAIL = 'owner@example.test';
export const OWNER_PASSWORD = 'correct horse battery staple';

/** Hash generated per run; no credential is ever committed. */
export const OWNER_PASSWORD_HASH = hashPassword(OWNER_PASSWORD);

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
  GITHUB_VAULT_BRANCH: 'main',
  SESSION_SECRET: 'test-session-secret-value-not-a-real-secret',
  OWNER_EMAIL,
  OWNER_NAME: 'Owner',
  AUTH_ENABLED: 'true'
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
      OWNER_PASSWORD_HASH,
      ...environment
    },
    fetchImpl,
    aiFetchImpl,
    now
  });

  return { app, vault: state, agent: request.agent(app) };
}

/** Signs in and returns an agent carrying the session and CSRF cookies. */
export async function signIn(app, { email = OWNER_EMAIL, password = OWNER_PASSWORD } = {}) {
  const agent = request.agent(app);
  const response = await agent.post('/api/v1/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Sign-in failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const csrf = extractCookie(response.headers['set-cookie'], 'nexus_csrf');

  return {
    agent,
    csrf,
    /** Issues a mutating request with the CSRF header already attached. */
    send: (method, path) => agent[method](path).set('x-csrf-token', csrf)
  };
}

export function extractCookie(setCookieHeader, name) {
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ''];
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1).split(';')[0]) : null;
}

/** Environment that enables writes, and optionally destructive operations. */
export const writeEnabled = (extra = {}) => ({
  WRITE_OPERATIONS_ENABLED: 'true',
  ...extra
});

export const destructiveEnabled = () => writeEnabled({ DESTRUCTIVE_OPERATIONS_ENABLED: 'true' });
