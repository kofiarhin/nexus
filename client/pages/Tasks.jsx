import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, Dialog, Field, SourceList, statusTone } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { OperationReview } from '../components/OperationReview.jsx';
import {
  runMutation,
  useCreateTask,
  useDeleteTask,
  useProjects,
  useTasks,
  useUpdateTask
} from '../lib/queries.js';

const VIEWS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' }
];

const BOARD_COLUMNS = ['todo', 'in-progress', 'blocked', 'done'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['todo', 'in-progress', 'blocked', 'done', 'archived'];
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'quarterly'];

const emptyDraft = {
  name: '',
  status: 'todo',
  priority: 'medium',
  dueDate: '',
  projectId: '',
  businessId: '',
  owner: '',
  recurrence: 'none',
  dependencies: '',
  blockers: ''
};

function TaskForm({ draft, setDraft, projects }) {
  const set = (key) => (event) => setDraft({ ...draft, [key]: event.target.value });

  return (
    <div className="form-grid">
      <Field label="Name" required>
        <input type="text" value={draft.name} onChange={set('name')} />
      </Field>
      <Field label="Status">
        <select value={draft.status} onChange={set('status')}>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Priority">
        <select value={draft.priority} onChange={set('priority')}>
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Due date" hint="ISO date, for example 2026-08-04">
        <input type="date" value={draft.dueDate} onChange={set('dueDate')} />
      </Field>
      <Field label="Project">
        <select value={draft.projectId} onChange={set('projectId')}>
          <option value="">None</option>
          {(projects ?? []).map((project) => (
            <option key={project.slug} value={project.slug}>
              {project.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Business">
        <input type="text" value={draft.businessId} onChange={set('businessId')} />
      </Field>
      <Field label="Owner">
        <input type="text" value={draft.owner} onChange={set('owner')} />
      </Field>
      <Field label="Recurrence">
        <select value={draft.recurrence} onChange={set('recurrence')}>
          {RECURRENCES.map((recurrence) => (
            <option key={recurrence} value={recurrence}>
              {recurrence}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Dependencies" hint="Comma-separated task IDs">
        <input type="text" value={draft.dependencies} onChange={set('dependencies')} />
      </Field>
      <Field label="Blockers" hint="Comma-separated descriptions">
        <input type="text" value={draft.blockers} onChange={set('blockers')} />
      </Field>
    </div>
  );
}

const toPayload = (draft) => ({
  name: draft.name,
  status: draft.status,
  priority: draft.priority,
  dueDate: draft.dueDate || undefined,
  projectId: draft.projectId || undefined,
  businessId: draft.businessId || undefined,
  owner: draft.owner || undefined,
  recurrence: draft.recurrence,
  dependencies: draft.dependencies ? draft.dependencies.split(',').map((item) => item.trim()).filter(Boolean) : [],
  blockers: draft.blockers ? draft.blockers.split(',').map((item) => item.trim()).filter(Boolean) : []
});

function TaskRow({ task, onEdit, onToggle, onDelete, busy }) {
  const done = task.status === 'done';

  return (
    <li className="task-row task-row-detailed">
      <div className="task-main">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={done}
            disabled={busy}
            onChange={() => onToggle(task)}
            aria-label={done ? `Reopen ${task.name}` : `Complete ${task.name}`}
          />
          <span className={done ? 'is-done' : undefined}>{task.name}</span>
        </label>
        <p className="muted task-source">
          <code>{task.sourcePath}</code>
          {task.dependencies.length > 0 && <> · depends on {task.dependencies.join(', ')}</>}
          {task.blockers.length > 0 && <> · blocked by {task.blockers.join(', ')}</>}
        </p>
      </div>
      <div className="task-meta">
        <Badge tone={statusTone(task.status)}>{task.status}</Badge>
        <Badge tone={['critical', 'high'].includes(task.priority) ? 'warning' : 'neutral'}>{task.priority}</Badge>
        {task.dueDate && <span className="muted">due {task.dueDate}</span>}
        {task.recurrence !== 'none' && <Badge tone="neutral">{task.recurrence}</Badge>}
        <button type="button" className="button button-ghost" onClick={() => onEdit(task)}>
          Edit
        </button>
        <button type="button" className="button button-ghost" onClick={() => onDelete(task)} disabled={busy}>
          Delete
        </button>
      </div>
    </li>
  );
}

export default function Tasks({ query }) {
  const [view, setView] = useState(query.view ?? 'all');
  const [mode, setMode] = useState('list');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [pendingOperation, setPendingOperation] = useState(null);

  const filters = {
    view,
    projectId: query.projectId ?? undefined,
    businessId: query.businessId ?? undefined
  };

  const tasks = useTasks(filters);
  const projects = useProjects();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const busy = createTask.isPending || updateTask.isPending || deleteTask.isPending;
  const mutationError = createTask.error ?? updateTask.error ?? deleteTask.error;

  const captureOperation = (result) => {
    // A material change returns a proposal that still needs approval.
    if (result?.operation && !result.executed) setPendingOperation(result.operation);
    else setPendingOperation(null);
  };

  const submitCreate = async (event) => {
    event.preventDefault();
    captureOperation(await runMutation(createTask, toPayload(draft)));
    setCreating(false);
    setDraft(emptyDraft);
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    captureOperation(await runMutation(updateTask, { taskId: editing.id, ...toPayload(draft) }));
    setEditing(null);
  };

  const toggle = async (task) => {
    captureOperation(
      await runMutation(updateTask, { taskId: task.id, status: task.status === 'done' ? 'todo' : 'done' })
    );
  };

  const remove = async (task) => {
    captureOperation(await runMutation(deleteTask, { taskId: task.id }));
  };

  const startEdit = (task) => {
    setDraft({
      name: task.name,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate ?? '',
      projectId: task.projectId ?? '',
      businessId: task.businessId ?? '',
      owner: task.owner ?? '',
      recurrence: task.recurrence,
      dependencies: task.dependencies.join(', '),
      blockers: task.blockers.join(', ')
    });
    setEditing(task);
  };

  const list = tasks.data?.tasks ?? [];

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Stored as annotated Markdown checklist items in your Vault."
        actions={
          <button type="button" className="button button-primary" onClick={() => { setDraft(emptyDraft); setCreating(true); }}>
            New task
          </button>
        }
      />

      <Card>
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Task view">
            {VIEWS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={view === option.value}
                className={view === option.value ? 'segment is-active' : 'segment'}
                onClick={() => setView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="segmented" role="tablist" aria-label="Display mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'list'}
              className={mode === 'list' ? 'segment is-active' : 'segment'}
              onClick={() => setMode('list')}
            >
              List
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'board'}
              className={mode === 'board' ? 'segment is-active' : 'segment'}
              onClick={() => setMode('board')}
            >
              Board
            </button>
          </div>
        </div>
      </Card>

      {mutationError && <ErrorState error={mutationError} compact />}

      {pendingOperation && (
        <Card title="Approval required" description="This change is recorded as a proposal until you approve it.">
          <OperationReview operation={pendingOperation} onChanged={() => { setPendingOperation(null); tasks.refetch(); }} />
        </Card>
      )}

      <Card>
        {tasks.isPending && <Loading label="Loading tasks…" />}
        {tasks.isError && <ErrorState error={tasks.error} onRetry={tasks.refetch} />}
        {tasks.isSuccess && list.length === 0 && (
          <Empty
            title="No tasks in this view"
            description="Create a task, or add annotated checklist items to tasks/TASKS.md in your Vault."
          />
        )}

        {tasks.isSuccess && list.length > 0 && mode === 'list' && (
          <ul className="task-list">
            {list.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                busy={busy}
                onEdit={startEdit}
                onToggle={toggle}
                onDelete={remove}
              />
            ))}
          </ul>
        )}

        {tasks.isSuccess && list.length > 0 && mode === 'board' && (
          <div className="board">
            {BOARD_COLUMNS.map((column) => (
              <section key={column} className="board-column" aria-label={column}>
                <h3>
                  {column} <span className="muted">{list.filter((task) => task.status === column).length}</span>
                </h3>
                <ul className="plain-list">
                  {list
                    .filter((task) => task.status === column)
                    .map((task) => (
                      <li key={task.id} className="board-card">
                        <strong>{task.name}</strong>
                        <p className="muted">
                          {task.priority}
                          {task.dueDate ? ` · due ${task.dueDate}` : ''}
                        </p>
                        <button type="button" className="button button-ghost" onClick={() => startEdit(task)}>
                          Edit
                        </button>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      {tasks.data?.sources && <SourceList sources={tasks.data.sources} title="Task sources" />}

      <Dialog
        open={creating}
        title="New task"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button type="button" className="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button type="submit" form="create-task" className="button button-primary" disabled={busy}>
              Create task
            </button>
          </>
        }
      >
        <form id="create-task" onSubmit={submitCreate}>
          <TaskForm draft={draft} setDraft={setDraft} projects={projects.data?.projects} />
        </form>
      </Dialog>

      <Dialog
        open={Boolean(editing)}
        title={`Edit ${editing?.name ?? 'task'}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-task" className="button button-primary" disabled={busy}>
              Save changes
            </button>
          </>
        }
      >
        <form id="edit-task" onSubmit={submitEdit}>
          <TaskForm draft={draft} setDraft={setDraft} projects={projects.data?.projects} />
        </form>
      </Dialog>
    </>
  );
}
