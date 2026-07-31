// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { OperationReview } from '../../client/components/OperationReview.jsx';
import { Dialog } from '../../client/components/Primitives.jsx';
import App from '../../client/App.jsx';
import { createApiStub, createTestQueryClient } from './helpers.jsx';

const MATERIAL_OPERATION = {
  id: 'op_1',
  action: 'replace',
  path: 'knowledge/topic.md',
  destinationPath: null,
  reason: 'Rewrite the note',
  risk: 'material',
  status: 'proposed',
  requiresApproval: true,
  requiresDestructiveConfirmation: false,
  expectedSha: 'abc1234567',
  stats: { added: 1, removed: 1, unchanged: 3 },
  diff: '--- a\n+++ b\n@@ -1,2 +1,2 @@\n-Old line\n+New line\n',
  sources: [{ path: 'knowledge/topic.md', sha: 'abc1234567', reason: 'Requested document' }],
  result: null
};

const DESTRUCTIVE_OPERATION = {
  ...MATERIAL_OPERATION,
  id: 'op_2',
  action: 'delete',
  risk: 'destructive',
  requiresDestructiveConfirmation: true,
  diff: ''
};

function renderOperation(operation, routes = {}) {
  const stub = createApiStub(routes);
  vi.stubGlobal('fetch', vi.fn(stub.handler));
  const onChanged = vi.fn();

  const view = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <OperationReview operation={operation} onChanged={onChanged} />
    </QueryClientProvider>
  );

  return { ...view, stub, onChanged };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('operation review', () => {
  it('shows the action, path, risk, status, and diff before anything is applied', () => {
    renderOperation(MATERIAL_OPERATION);

    expect(screen.getByText('replace')).toBeTruthy();
    // Shown in the header and again in the source manifest.
    expect(screen.getAllByText('knowledge/topic.md').length).toBeGreaterThan(0);
    expect(screen.getByText('material')).toBeTruthy();
    expect(screen.getByText('proposed')).toBeTruthy();
    expect(screen.getByText('-Old line')).toBeTruthy();
    expect(screen.getByText('+New line')).toBeTruthy();
    expect(screen.getByLabelText('Proposed change')).toBeTruthy();
  });

  it('keeps approval and execution as separate steps for a material change', () => {
    renderOperation(MATERIAL_OPERATION);

    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull();
  });

  it('offers execution only once the operation is approved', () => {
    renderOperation({ ...MATERIAL_OPERATION, status: 'approved' });

    expect(screen.getByRole('button', { name: 'Execute' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('approves through the API and reports the result', async () => {
    const user = userEvent.setup();
    const { stub, onChanged } = renderOperation(MATERIAL_OPERATION, {
      'POST /operations/op_1/approve': { operation: { ...MATERIAL_OPERATION, status: 'approved' } }
    });

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(stub.calls.some((call) => call.path === '/operations/op_1/approve')).toBe(true);
  });

  it('rejects without executing anything', async () => {
    const user = userEvent.setup();
    const { stub, onChanged } = renderOperation(MATERIAL_OPERATION, {
      'POST /operations/op_1/reject': { operation: { ...MATERIAL_OPERATION, status: 'rejected' } }
    });

    await user.click(screen.getByRole('button', { name: 'Reject' }));

    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(stub.calls.some((call) => call.path.endsWith('/execute'))).toBe(false);
  });

  it('surfaces a revision conflict with both revisions', async () => {
    const user = userEvent.setup();
    renderOperation({ ...MATERIAL_OPERATION, status: 'approved' }, {
      'POST /operations/op_1/execute': {
        status: 409,
        error: {
          code: 'VAULT_CONFLICT',
          message: 'The Vault file changed since it was read',
          details: { expectedRevision: 'aaaaaaa', currentRevision: 'bbbbbbb' }
        }
      }
    });

    await user.click(screen.getByRole('button', { name: 'Execute' }));

    expect(await screen.findByText(/the document changed/i)).toBeTruthy();
    expect(screen.getByText('aaaaaaa')).toBeTruthy();
    expect(screen.getByText('bbbbbbb')).toBeTruthy();
  });

  it('shows the Git commit once the operation succeeded', () => {
    renderOperation({
      ...MATERIAL_OPERATION,
      status: 'succeeded',
      result: { commit: 'commit1234567', verified: true }
    });

    expect(screen.getByText('commit1234')).toBeTruthy();
    expect(screen.getByText(/verified by readback/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('warns when a no-op append would change nothing', () => {
    renderOperation({ ...MATERIAL_OPERATION, note: 'The appended content is already present; no change is required.' });
    expect(screen.getByText(/already present/i)).toBeTruthy();
  });
});

describe('destructive confirmation', () => {
  it('requires the exact path to be typed before deleting', async () => {
    const user = userEvent.setup();
    const { stub } = renderOperation({ ...DESTRUCTIVE_OPERATION, status: 'approved' }, {
      'POST /operations/op_2/execute': { operation: { ...DESTRUCTIVE_OPERATION, status: 'succeeded' } }
    });

    await user.click(screen.getByRole('button', { name: /delete permanently…/i }));

    await screen.findByRole('dialog');
    // Re-query each time: React replaces the footer button as state changes.
    const confirmButton = () => screen.getByRole('button', { name: 'Delete permanently' });
    const pathInput = () => screen.getByLabelText(/type the full path/i);

    expect(confirmButton().disabled).toBe(true);

    await user.type(pathInput(), 'wrong/path.md');
    expect(confirmButton().disabled).toBe(true);

    await user.clear(pathInput());
    await user.type(pathInput(), 'knowledge/topic.md');
    expect(confirmButton().disabled).toBe(false);

    await user.click(confirmButton());

    await vi.waitFor(() => {
      const call = stub.calls.find((entry) => entry.path === '/operations/op_2/execute');
      expect(call?.body.confirmDestructive).toBe(true);
    });
  });

  it('explains that archiving is the reversible alternative', async () => {
    const user = userEvent.setup();
    renderOperation({ ...DESTRUCTIVE_OPERATION, status: 'approved' });

    await user.click(screen.getByRole('button', { name: /delete permanently…/i }));

    expect(await screen.findByText(/archiving is the reversible alternative/i)).toBeTruthy();
  });
});

describe('dialog accessibility', () => {
  it('is a modal dialog labelled by its title, and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <Dialog open title="Confirm something" onClose={onClose}>
        <button type="button">Inside</button>
      </Dialog>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByRole('heading', { name: 'Confirm something' })).toBeTruthy();

    await vi.waitFor(() => expect(document.activeElement).not.toBe(document.body));

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<Dialog open={false} title="Hidden" onClose={() => {}}>content</Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('task administration', () => {
  const TASKS = {
    tasks: [{
      id: 'tsk-1',
      name: 'Review the quarterly plan',
      status: 'todo',
      priority: 'high',
      dueDate: '2026-07-31',
      projectId: null,
      businessId: null,
      owner: null,
      recurrence: 'none',
      dependencies: [],
      blockers: [],
      sourcePath: 'tasks/TASKS.md'
    }],
    total: 1,
    sources: [{ path: 'tasks/TASKS.md', sha: 'abc1234', reason: 'Deterministic task source' }]
  };

  function mountTasks(routes = {}) {
    const stub = createApiStub({
      '/tasks': TASKS,
      '/projects': { projects: [] },
      ...routes
    });
    vi.stubGlobal('fetch', vi.fn(stub.handler));
    window.history.replaceState({}, '', '/tasks');
    return { stub, ...render(<App queryClient={createTestQueryClient()} initialPath="/tasks" />) };
  }

  it('renders list and board views with the task source', async () => {
    const user = userEvent.setup();
    mountTasks();

    expect(await screen.findByText('Review the quarterly plan')).toBeTruthy();
    expect(screen.getAllByText('tasks/TASKS.md').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Board' }));
    expect(screen.getByRole('region', { name: 'todo' })).toBeTruthy();
  });

  it('completes a task through a labelled checkbox', async () => {
    const user = userEvent.setup();
    const { stub } = mountTasks({
      'PATCH /tasks/tsk-1': { task: { ...TASKS.tasks[0], status: 'done' }, operation: null, executed: true }
    });

    const checkbox = await screen.findByLabelText(/complete review the quarterly plan/i);
    await user.click(checkbox);

    await vi.waitFor(() => {
      const call = stub.calls.find((entry) => entry.method === 'PATCH');
      expect(call?.body).toEqual({ status: 'done' });
    });
  });

  it('shows a proposal for review when the change needs approval', async () => {
    const user = userEvent.setup();
    mountTasks({
      'PATCH /tasks/tsk-1': {
        task: TASKS.tasks[0],
        executed: false,
        operation: { ...MATERIAL_OPERATION, path: 'tasks/TASKS.md' }
      }
    });

    await user.click(await screen.findByLabelText(/complete review the quarterly plan/i));

    expect(await screen.findByText('Approval required')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('opens a labelled creation form', async () => {
    const user = userEvent.setup();
    mountTasks();

    await user.click(await screen.findByRole('button', { name: 'New task' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/name/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/priority/i)).toBeTruthy();
    expect(within(dialog).getByLabelText(/due date/i)).toBeTruthy();
  });

  it('surfaces a permission failure when writes are disabled', async () => {
    const user = userEvent.setup();
    mountTasks({
      'PATCH /tasks/tsk-1': {
        status: 503,
        error: { code: 'VAULT_WRITE_DISABLED', message: 'Vault write operations are disabled.' }
      }
    });

    await user.click(await screen.findByLabelText(/complete review the quarterly plan/i));

    expect(await screen.findByText(/writes are disabled/i)).toBeTruthy();
  });

  it('reports an empty task view without implying an error', async () => {
    mountTasks({ '/tasks': { tasks: [], total: 0, sources: [] } });

    expect(await screen.findByText(/no tasks in this view/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
