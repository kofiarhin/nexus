import { VAULT_PATHS } from '../config/policy.js';
import { parseTasks, serializeTask } from '../repositories/taskRepository.js';
import { appError } from '../utils/errors.js';
import { derivedId } from '../utils/ids.js';
import { replaceLine } from '../utils/markdown.js';

const today = (now) => now.toISOString().slice(0, 10);

const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const OPEN_STATUSES = new Set(['todo', 'in-progress', 'blocked']);

/** Deterministic task views. No AI participates in any of these filters. */
export function selectTasks(tasks, { view = 'all', status, priority, projectId, businessId, search }, now = new Date()) {
  const day = today(now);
  const horizon = addDays(day, 7);

  let selected = tasks;

  if (view === 'today') {
    selected = selected.filter((task) => OPEN_STATUSES.has(task.status) && task.dueDate !== null && task.dueDate <= day);
  } else if (view === 'overdue') {
    selected = selected.filter((task) => OPEN_STATUSES.has(task.status) && task.dueDate !== null && task.dueDate < day);
  } else if (view === 'upcoming') {
    selected = selected.filter(
      (task) => OPEN_STATUSES.has(task.status) && task.dueDate !== null && task.dueDate > day && task.dueDate <= horizon
    );
  } else if (view === 'completed') {
    selected = selected.filter((task) => task.status === 'done');
  } else if (view === 'recurring') {
    selected = selected.filter((task) => task.recurrence && task.recurrence !== 'none');
  } else if (view === 'blocked') {
    selected = selected.filter((task) => task.status === 'blocked' || task.blockers.length > 0);
  }

  if (status) selected = selected.filter((task) => task.status === status);
  if (priority) selected = selected.filter((task) => task.priority === priority);
  if (projectId) selected = selected.filter((task) => task.projectId === projectId);
  if (businessId) selected = selected.filter((task) => task.businessId === businessId);
  if (search) {
    const needle = search.toLowerCase();
    selected = selected.filter((task) => task.name.toLowerCase().includes(needle));
  }

  return selected;
}

const PRIORITY_WEIGHT = { critical: 0, high: 1, medium: 2, low: 3 };

/** Stable ordering: due date first, then priority, then name. */
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const dueA = a.dueDate ?? '9999-12-31';
    const dueB = b.dueDate ?? '9999-12-31';
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    const priorityDelta = (PRIORITY_WEIGHT[a.priority] ?? 9) - (PRIORITY_WEIGHT[b.priority] ?? 9);
    if (priorityDelta !== 0) return priorityDelta;
    return a.name.localeCompare(b.name);
  });
}

export class TaskService {
  constructor({ taskRepository, operationService, now = () => new Date() }) {
    this.taskRepository = taskRepository;
    this.operationService = operationService;
    this.now = now;
  }

  async list(query = {}) {
    const { tasks, files } = await this.taskRepository.list();
    const selected = sortTasks(selectTasks(tasks, query, this.now()));
    return {
      tasks: selected,
      total: tasks.length,
      sources: files.map((file) => ({
        path: file.path,
        sha: file.revision,
        title: 'Task records',
        reason: 'Deterministic task source'
      }))
    };
  }

  async get(taskId) {
    const found = await this.taskRepository.get(taskId);
    if (!found) throw appError('NOT_FOUND', 'Task not found');
    return {
      task: found.task,
      sources: [
        { path: found.file.path, sha: found.file.revision, title: 'Task records', reason: 'Task source document' }
      ]
    };
  }

  /** Counts used by Today and reports; computed without AI. */
  async summary() {
    const { tasks } = await this.taskRepository.list();
    const day = today(this.now());
    return {
      total: tasks.length,
      open: tasks.filter((task) => OPEN_STATUSES.has(task.status)).length,
      overdue: tasks.filter((task) => OPEN_STATUSES.has(task.status) && task.dueDate && task.dueDate < day).length,
      dueToday: tasks.filter((task) => OPEN_STATUSES.has(task.status) && task.dueDate === day).length,
      blocked: tasks.filter((task) => task.status === 'blocked' || task.blockers.length > 0).length,
      completed: tasks.filter((task) => task.status === 'done').length
    };
  }

  #buildTask(input, existing = null) {
    const stamp = this.now().toISOString();
    const name = input.name ?? existing?.name;
    const path = input.path ?? existing?.sourcePath ?? VAULT_PATHS.taskFile;

    return {
      id: existing?.id ?? derivedId('tsk', path, `${name}:${stamp}`),
      name,
      status: input.status ?? existing?.status ?? 'todo',
      priority: input.priority ?? existing?.priority ?? 'medium',
      dueDate: input.dueDate === '' ? null : input.dueDate ?? existing?.dueDate ?? null,
      businessId: input.businessId ?? existing?.businessId ?? null,
      projectId: input.projectId ?? existing?.projectId ?? null,
      owner: input.owner ?? existing?.owner ?? null,
      recurrence: input.recurrence ?? existing?.recurrence ?? 'none',
      dependencies: input.dependencies ?? existing?.dependencies ?? [],
      blockers: input.blockers ?? existing?.blockers ?? [],
      createdAt: existing?.createdAt ?? stamp.slice(0, 10),
      updatedAt: stamp.slice(0, 10),
      completedAt: (input.status ?? existing?.status) === 'done'
        ? existing?.completedAt ?? stamp.slice(0, 10)
        : null,
      indent: existing?.indent ?? '',
      marker: existing?.marker ?? '-'
    };
  }

  /** Creating a task appends one annotated checklist line to a task document. */
  async create({ actor, requestId, idempotencyKey, ...input }) {
    const task = this.#buildTask(input);
    const path = input.path ?? VAULT_PATHS.taskFile;

    const line = serializeTask(task);
    const existingFile = await this.taskRepository.vaultRepository.readTextIfExists(path);

    if (!existingFile) {
      const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
        actor,
        requestId,
        idempotencyKey,
        action: 'create',
        path,
        content: `# Tasks\n\n## Open\n\n${line}\n`,
        reason: `Create task "${task.name}"`,
        message: `Create task ${task.id}`,
        source: 'manual'
      });
      return { task, operation, executed };
    }

    const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
      actor,
      requestId,
      idempotencyKey,
      action: 'append',
      path,
      content: line,
      underHeading: 'Open',
      expectedSha: existingFile.revision,
      reason: `Create task "${task.name}"`,
      message: `Create task ${task.id}`,
      source: 'manual'
    });

    return { task, operation, executed };
  }

  /**
   * Updating rewrites the task's single source line in place.
   * The surrounding document is untouched, so hand-written notes survive.
   */
  async update({ taskId, actor, requestId, idempotencyKey, approve, ...changes }) {
    const found = await this.taskRepository.get(taskId);
    if (!found) throw appError('NOT_FOUND', 'Task not found');

    const updated = this.#buildTask(changes, found.task);
    const line = serializeTask(updated);
    const content = replaceLine(found.file.content, found.task.sourceLine, line);

    if (content === found.file.content) {
      return { task: updated, operation: null, executed: false, unchanged: true };
    }

    const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
      actor,
      requestId,
      idempotencyKey,
      approve,
      action: 'replace',
      path: found.file.path,
      content,
      expectedSha: found.file.revision,
      reason: `Update task "${updated.name}"`,
      message: `Update task ${updated.id}`,
      source: 'manual'
    });

    return { task: updated, operation, executed };
  }

  complete({ taskId, ...rest }) {
    return this.update({ taskId, status: 'done', ...rest });
  }

  reopen({ taskId, ...rest }) {
    return this.update({ taskId, status: 'todo', ...rest });
  }

  archive({ taskId, ...rest }) {
    return this.update({ taskId, status: 'archived', ...rest });
  }

  /** Hard delete removes the task's line from its source document. */
  async remove({ taskId, actor, requestId, idempotencyKey, approve }) {
    const found = await this.taskRepository.get(taskId);
    if (!found) throw appError('NOT_FOUND', 'Task not found');

    const content = replaceLine(found.file.content, found.task.sourceLine, null);

    const { operation, executed } = await this.operationService.proposeAndMaybeExecute({
      actor,
      requestId,
      idempotencyKey,
      approve,
      action: 'replace',
      path: found.file.path,
      content,
      expectedSha: found.file.revision,
      reason: `Delete task "${found.task.name}"`,
      message: `Delete task ${taskId}`,
      source: 'manual'
    });

    return { task: found.task, operation, executed };
  }
}

export { parseTasks, OPEN_STATUSES };
