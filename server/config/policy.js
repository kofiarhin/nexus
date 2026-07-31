/**
 * Vault conventions and the deterministic operation policy.
 *
 * Risk classification and approval requirements live here, never in the model
 * layer: NVIDIA may propose an operation but cannot influence how risky the
 * server considers it.
 */

export const VAULT_PATHS = {
  workspaceRules: 'NEXUS.md',
  projectRegistry: 'registry/PROJECTS.md',
  businessRegistry: 'registry/BUSINESSES.md',
  taskFile: 'tasks/TASKS.md',
  inboxFile: 'inbox/INBOX.md',
  memoryFile: 'memory/MEMORY.md',
  knowledgeDirectory: 'knowledge',
  dailyDirectory: 'daily',
  reportsDirectory: 'reports',
  projectsDirectory: 'projects',
  businessesDirectory: 'businesses'
};

export const OPERATION_ACTIONS = [
  'create',
  'replace',
  'patch',
  'append',
  'move',
  'archive',
  'delete',
  'restore'
];

export const OPERATION_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'executing',
  'succeeded',
  'conflicted',
  'failed',
  'rolled-back'
];

export const RISK_LEVELS = ['low', 'material', 'destructive'];

/**
 * Operational capture surfaces. Content here is routine, high-volume, and
 * fully recoverable from Git history, so edits are classified low risk.
 * Knowledge, project, business, and registry documents are not included.
 */
const LOW_RISK_PREFIXES = ['inbox', 'daily', 'tasks'];

/**
 * A per-project `TASKS.md` is an operational task surface, so it is treated
 * like the shared task file even though it sits beside a project document.
 * The project document itself stays material.
 */
const LOW_RISK_BASENAMES = ['TASKS.md'];

const LOW_RISK_ACTIONS = new Set(['create', 'append', 'replace', 'patch']);

const startsWithPrefix = (path, prefixes) => prefixes.some(
  (prefix) => path === prefix || path.startsWith(`${prefix}/`)
);

const hasBasename = (path, basenames) => basenames.includes(String(path ?? '').split('/').pop());

/**
 * Deterministic risk classification.
 *
 * `delete` is always destructive. Moving or archiving relocates a record and
 * always stays material. Everything outside the capture surfaces is material
 * and therefore requires an explicit approval before execution.
 */
export function classifyRisk({ action, path }) {
  if (action === 'delete') return 'destructive';
  if (!LOW_RISK_ACTIONS.has(action)) return 'material';
  if (startsWithPrefix(path ?? '', LOW_RISK_PREFIXES)) return 'low';
  if (hasBasename(path, LOW_RISK_BASENAMES)) return 'low';
  return 'material';
}

/**
 * Whether approval and execution may be combined for this operation.
 * Material and destructive operations always stay separate (specification
 * section 18).
 */
export function canAutoExecute({ risk, source, autoApproveLowRisk }) {
  return risk === 'low' && source === 'manual' && autoApproveLowRisk === true;
}

export function requiresDestructiveConfirmation(risk) {
  return risk === 'destructive';
}

export function isWriteAction(action) {
  return OPERATION_ACTIONS.includes(action);
}

export const TASK_STATUSES = ['todo', 'in-progress', 'blocked', 'done', 'archived'];
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const TASK_RECURRENCES = ['none', 'daily', 'weekly', 'monthly', 'quarterly'];

export const MEMORY_TYPES = ['fact', 'preference', 'decision', 'goal', 'lesson', 'profile'];

export const CONVERSATION_SCOPES = ['vault', 'business', 'project', 'document', 'custom'];

export const INBOX_KINDS = ['note', 'idea', 'task', 'request', 'unclassified'];
