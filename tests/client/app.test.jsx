// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../client/App.jsx';
import { AUTH_STATUS, createApiStub, createTestQueryClient } from './helpers.jsx';

const PLAN = {
  date: '2026-07-31',
  aiAvailable: false,
  counts: { open: 2, overdue: 1, dueToday: 1, upcoming: 0, blocked: 0 },
  recommendations: [
    {
      taskId: 'tsk-1',
      title: 'Review the quarterly plan',
      score: 90,
      basis: 'deterministic',
      reasons: ['Overdue since 2026-07-01', 'Priority is high'],
      sources: [{ path: 'tasks/TASKS.md', reason: 'Task record for this recommendation' }]
    }
  ],
  overdue: [{ id: 'tsk-1', name: 'Review the quarterly plan', status: 'todo', priority: 'high', dueDate: '2026-07-01' }],
  dueToday: [],
  upcoming: [],
  blocked: [],
  unresolvedDecisions: [{ projectId: 'nexus', projectName: 'Nexus', question: 'Where should reports live?' }],
  businessAlerts: [{ businessId: 'acme', name: 'Acme Studio', status: 'active' }],
  recentActivity: [],
  dailyNotes: [],
  sources: [{ path: 'tasks/TASKS.md', sha: 'abc1234', reason: 'Deterministic task source' }]
};

/** Mounts the real App at a path, against a stubbed API. */
function mountApp(routes, { path = '/today' } = {}) {
  const stub = createApiStub({ '/auth/status': AUTH_STATUS, ...routes });
  vi.stubGlobal('fetch', vi.fn(stub.handler));
  window.history.replaceState({}, '', path);
  return { stub, ...render(<App queryClient={createTestQueryClient()} initialPath={path} />) };
}

// Auto-cleanup is not active without Vitest globals, so unmount explicitly.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('authentication gate', () => {
  it('shows the sign-in screen when no session is active', async () => {
    mountApp({ '/auth/status': { ...AUTH_STATUS, authenticated: false } });

    expect(await screen.findByRole('heading', { name: 'Nexus' })).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('explains an unconfigured owner instead of offering a form', async () => {
    mountApp({ '/auth/status': { ...AUTH_STATUS, authenticated: false, authConfigured: false } });

    expect(await screen.findByText(/owner sign-in is not configured/i)).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it('surfaces invalid credentials without clearing the form', async () => {
    const user = userEvent.setup();
    mountApp({
      '/auth/status': { ...AUTH_STATUS, authenticated: false },
      'POST /auth/login': { status: 401, error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } }
    });

    await screen.findByLabelText(/email/i);
    await user.type(screen.getByLabelText(/email/i), 'owner@example.test');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/email or password is incorrect/i)).toBeTruthy();
  });

  it('reports an unreachable API rather than a blank screen', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    render(<App queryClient={createTestQueryClient()} initialPath="/today" />);

    expect(await screen.findByText(/cannot reach the api/i)).toBeTruthy();
  });
});

describe('command center shell', () => {
  it('renders every primary navigation destination', async () => {
    mountApp({ '/planning/today': PLAN });

    const navigation = await screen.findByRole('navigation', { name: 'Primary' });
    for (const label of [
      'Today', 'Chat', 'Businesses', 'Projects', 'Tasks', 'Inbox', 'Documents',
      'Knowledge', 'Memory', 'Daily Notes', 'Reports', 'Activity', 'Settings'
    ]) {
      expect(within(navigation).getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('marks the active destination for assistive technology', async () => {
    mountApp({ '/planning/today': PLAN });

    const navigation = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(navigation).getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page');
    expect(within(navigation).getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBeNull();
  });

  it('navigates between routes without a full page load', async () => {
    const user = userEvent.setup();
    mountApp({
      '/planning/today': PLAN,
      '/projects': { projects: [{ name: 'Nexus', slug: 'nexus', path: 'projects/nexus/PROJECT.md', summary: 'Command center' }] }
    });

    const navigation = await screen.findByRole('navigation', { name: 'Primary' });
    await user.click(within(navigation).getByRole('link', { name: 'Projects' }));

    expect(await screen.findByRole('heading', { name: 'Projects', level: 1 })).toBeTruthy();
    expect(screen.getByText('Command center')).toBeTruthy();
    expect(window.location.pathname).toBe('/projects');
  });

  it('exposes a skip link and a labelled mobile navigation toggle', async () => {
    mountApp({ '/planning/today': PLAN });

    expect(await screen.findByText(/skip to main content/i)).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /menu/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('primary-navigation');
  });

  it('shows a read-only badge when Vault writes are disabled', async () => {
    mountApp({
      '/auth/status': { ...AUTH_STATUS, writeOperationsEnabled: false },
      '/planning/today': PLAN
    });

    expect(await screen.findByText('Read only')).toBeTruthy();
  });

  it('renders a not-found state for an unknown route', async () => {
    mountApp({}, { path: '/nowhere' });
    expect(await screen.findByText(/page not found/i)).toBeTruthy();
  });
});

describe('Today', () => {
  it('shows recommendations with their reasons and sources', async () => {
    mountApp({ '/planning/today': PLAN });

    // The task appears in both the recommendation list and the overdue card.
    expect((await screen.findAllByText('Review the quarterly plan')).length).toBeGreaterThan(0);
    expect(screen.getByText('Overdue since 2026-07-01')).toBeTruthy();
    expect(screen.getByText('Priority is high')).toBeTruthy();
    expect(screen.getAllByText('tasks/TASKS.md').length).toBeGreaterThan(0);
  });

  it('explains that recommendations remain available without the reasoning provider', async () => {
    mountApp({ '/planning/today': PLAN });
    expect(await screen.findByText(/reasoning provider is not configured/i)).toBeTruthy();
  });

  it('shows a loading state before the plan resolves', async () => {
    mountApp({ '/planning/today': PLAN });
    expect(screen.getByRole('status')).toBeTruthy();
    await screen.findByRole('heading', { name: 'Today', level: 1 });
  });

  it('distinguishes an unconfigured Vault from an empty one', async () => {
    mountApp({
      '/planning/today': { status: 503, error: { code: 'VAULT_NOT_CONFIGURED', message: 'GitHub Vault is not configured' } }
    });

    expect(await screen.findByText(/vault not configured/i)).toBeTruthy();
    expect(screen.getByText(/GITHUB_TOKEN/)).toBeTruthy();
  });

  it('reports an empty plan without implying an error', async () => {
    mountApp({
      '/planning/today': {
        ...PLAN,
        recommendations: [],
        overdue: [],
        counts: { open: 0, overdue: 0, dueToday: 0, upcoming: 0, blocked: 0 }
      }
    });

    expect(await screen.findByText(/no open work/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Settings', () => {
  it('reports configuration state and the reason writes are disabled', async () => {
    mountApp({
      '/settings': {
        authentication: { authEnabled: true, authConfigured: false, owner: null },
        vault: { repository: 'kofiarhin/nexus-vault', branch: 'main', configured: true, readPaths: ['projects'], writePaths: ['tasks'] },
        reasoning: { provider: 'nvidia', configured: false, model: null, timeoutMs: 45000 },
        operations: {
          writeOperationsEnabled: false,
          writeOperationsRequested: true,
          destructiveOperationsEnabled: false,
          destructiveOperationsRequested: false,
          autoApproveLowRisk: true,
          allowedActions: []
        },
        context: { maxSources: 12, maxCharacters: 60000, searchMaxFiles: 250 },
        environment: { nodeEnv: 'test' }
      }
    }, { path: '/settings' });

    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(screen.getByText(/writes remain disabled because owner authentication is not configured/i)).toBeTruthy();
    expect(screen.getByText(/keep the vault repository private/i)).toBeTruthy();
  });
});

describe('Activity', () => {
  it('renders the audit trail with revisions and commits', async () => {
    mountApp({
      '/activity': {
        events: [{
          id: 'aud-1',
          result: 'succeeded',
          action: 'replace',
          path: 'knowledge/topic.md',
          risk: 'material',
          beforeRevision: 'aaaaaaaaaa',
          afterRevision: 'bbbbbbbbbb',
          commit: 'cccccccccc',
          actor: { email: 'owner@example.test' },
          timestamp: '2026-07-31T09:00:00.000Z'
        }]
      },
      '/operations': { operations: [] }
    }, { path: '/activity' });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('succeeded')).toBeTruthy();
    expect(within(table).getByText('knowledge/topic.md')).toBeTruthy();
    expect(within(table).getByText('cccccccccc')).toBeTruthy();
  });

  it('reports an empty audit trail as a session-scoped state', async () => {
    mountApp({ '/activity': { events: [] }, '/operations': { operations: [] } }, { path: '/activity' });
    expect(await screen.findByText(/no activity recorded/i)).toBeTruthy();
  });
});

describe('Documents', () => {
  const TREE = {
    path: '',
    truncated: false,
    entries: [{
      path: 'knowledge',
      name: 'knowledge',
      type: 'dir',
      children: [{ path: 'knowledge/topic.md', name: 'topic.md', type: 'file', revision: 'rev1', writable: true }]
    }]
  };

  it('renders the Vault tree and prompts for a selection', async () => {
    mountApp({ '/vault/tree': TREE }, { path: '/documents' });

    expect(await screen.findByRole('button', { name: /knowledge/i })).toBeTruthy();
    expect(screen.getByText(/no document selected/i)).toBeTruthy();
  });

  it('renders a selected document as sanitized Markdown', async () => {
    mountApp({
      '/vault/tree': TREE,
      '/vault/files': {
        file: {
          path: 'knowledge/topic.md',
          title: 'Topic',
          content: '# Topic\n\nBody with a [link](javascript:alert(1)) and a [safe link](https://example.com).\n',
          revision: 'rev1234567',
          writable: true,
          sources: [{ path: 'knowledge/topic.md', sha: 'rev1234567', reason: 'Requested document' }]
        }
      },
      '/vault/files/history': { path: 'knowledge/topic.md', revisions: [] }
    }, { path: '/documents/knowledge/topic.md' });

    // One heading from the document toolbar, one from the rendered Markdown.
    expect((await screen.findAllByRole('heading', { name: 'Topic' })).length).toBe(2);

    // The unsafe link is rendered as plain text, the safe one as an anchor.
    expect(screen.queryByRole('link', { name: 'link' })).toBeNull();
    expect(screen.getByRole('link', { name: 'safe link' }).getAttribute('href')).toBe('https://example.com');
  });

  it('shows a conflict distinctly from a generic failure', async () => {
    mountApp({
      '/vault/tree': TREE,
      '/vault/files': {
        status: 409,
        error: {
          code: 'VAULT_CONFLICT',
          message: 'The Vault file changed since it was read',
          details: { expectedRevision: 'aaaaaaa', currentRevision: 'bbbbbbb' }
        }
      }
    }, { path: '/documents/knowledge/topic.md' });

    expect(await screen.findByText(/the document changed/i)).toBeTruthy();
    expect(screen.getByText('aaaaaaa')).toBeTruthy();
    expect(screen.getByText('bbbbbbb')).toBeTruthy();
  });
});
