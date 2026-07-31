import { TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES, VAULT_PATHS } from '../config/policy.js';
import { derivedId } from '../utils/ids.js';
import { parseAnnotationList, parseChecklistItems, serializeAnnotations } from '../utils/markdown.js';

const ANNOTATION_ORDER = [
  'id',
  'status',
  'priority',
  'due',
  'project',
  'business',
  'owner',
  'recurrence',
  'depends',
  'blocked',
  'created',
  'updated',
  'completed'
];

const enumOr = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * Resolves task status from the checkbox and the optional `@status` annotation.
 * The checkbox is authoritative for completion so a hand-edited Vault file is
 * never misread.
 */
function resolveStatus(checked, annotated) {
  const candidate = enumOr(String(annotated ?? '').toLowerCase(), TASK_STATUSES, null);
  if (checked) return candidate === 'archived' ? 'archived' : 'done';
  if (candidate === null) return 'todo';
  return candidate === 'done' ? 'todo' : candidate;
}

/**
 * Parses annotated checklist items into task records.
 *
 * Plain `- [ ] Do the thing` lines parse fine: every field except the name has
 * a default, and the id is derived deterministically from the source path and
 * text so unannotated Vault tasks keep stable identifiers.
 */
export function parseTasks(markdown, sourcePath) {
  return parseChecklistItems(markdown).map((item) => {
    const annotations = item.annotations ?? {};
    const status = resolveStatus(item.checked, annotations.status);

    return {
      id: annotations.id || derivedId('tsk', sourcePath, item.text),
      name: item.text,
      status,
      priority: enumOr(String(annotations.priority ?? '').toLowerCase(), TASK_PRIORITIES, 'medium'),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(annotations.due ?? '') ? annotations.due : null,
      businessId: annotations.business || null,
      projectId: annotations.project || null,
      owner: annotations.owner || null,
      recurrence: enumOr(String(annotations.recurrence ?? '').toLowerCase(), TASK_RECURRENCES, 'none'),
      dependencies: parseAnnotationList(annotations.depends),
      blockers: parseAnnotationList(annotations.blocked),
      createdAt: annotations.created || null,
      updatedAt: annotations.updated || null,
      completedAt: annotations.completed || null,
      sourcePath,
      sourceLine: item.line,
      indent: item.indent,
      marker: item.marker,
      hasExplicitId: Boolean(annotations.id)
    };
  });
}

/** Renders a task back to a single Markdown checklist line. */
export function serializeTask(task) {
  const annotations = {
    id: task.id,
    status: task.status,
    priority: task.priority,
    due: task.dueDate ?? '',
    project: task.projectId ?? '',
    business: task.businessId ?? '',
    owner: task.owner ?? '',
    recurrence: task.recurrence && task.recurrence !== 'none' ? task.recurrence : '',
    depends: (task.dependencies ?? []).join(','),
    blocked: (task.blockers ?? []).join(','),
    created: task.createdAt ?? '',
    updated: task.updatedAt ?? '',
    completed: task.completedAt ?? ''
  };

  const ordered = Object.fromEntries(
    ANNOTATION_ORDER.map((key) => [key, annotations[key]]).filter(([, value]) => value !== undefined)
  );

  const box = task.status === 'done' || task.status === 'archived' ? 'x' : ' ';
  const marker = task.marker ?? '-';
  const indent = task.indent ?? '';
  const suffix = serializeAnnotations(ordered);

  return `${indent}${marker} [${box}] ${task.name}${suffix ? ` ${suffix}` : ''}`;
}

export class TaskRepository {
  constructor({ vaultRepository, projectRepository }) {
    this.vaultRepository = vaultRepository;
    this.projectRepository = projectRepository;
  }

  /**
   * Task documents: the shared task file plus a per-project `TASKS.md` beside
   * each registered project document.
   */
  async listTaskFilePaths() {
    const paths = [VAULT_PATHS.taskFile];

    try {
      const projects = await this.projectRepository.list();
      for (const project of projects) {
        const directory = project.path.split('/').slice(0, -1).join('/');
        if (!directory) continue;
        const candidate = `${directory}/TASKS.md`;
        if (!paths.includes(candidate)) paths.push(candidate);
      }
    } catch {
      // A missing or unreadable project registry must not hide the shared task
      // file; deterministic task reads degrade rather than fail.
    }

    return paths;
  }

  async listTaskFiles() {
    const paths = await this.listTaskFilePaths();
    const files = await Promise.all(paths.map((path) => this.vaultRepository.readTextIfExists(path)));
    return files.filter(Boolean);
  }

  async list() {
    const files = await this.listTaskFiles();
    const tasks = files.flatMap((file) => parseTasks(file.content, file.path));
    return {
      tasks,
      files: files.map((file) => ({ path: file.path, revision: file.revision }))
    };
  }

  async get(taskId) {
    const files = await this.listTaskFiles();
    for (const file of files) {
      const task = parseTasks(file.content, file.path).find((candidate) => candidate.id === taskId);
      if (task) return { task, file };
    }
    return null;
  }
}
