import {
  CONVERSATION_SCOPES,
  INBOX_KINDS,
  MEMORY_TYPES,
  OPERATION_ACTIONS,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUSES
} from '../config/policy.js';

// Traversal is rejected here as well as in normalizeVaultPath, so a
// model-generated path never reaches the Vault layer to be checked.
const PATH_RULE = {
  type: 'string',
  maxLength: 400,
  pattern: /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
  patternMessage: 'must be a repository-relative Vault path without traversal'
};

const ID_RULE = {
  type: 'string',
  maxLength: 128,
  pattern: /^[A-Za-z0-9._-]+$/,
  patternMessage: 'must contain only letters, numbers, dots, dashes, or underscores'
};

export const loginSchema = {
  email: { type: 'string', required: true, maxLength: 320, lowercase: true },
  password: { type: 'string', required: true, maxLength: 512, trim: false }
};

export const taskCreateSchema = {
  name: { type: 'string', required: true, maxLength: 300 },
  status: { type: 'string', enum: TASK_STATUSES, default: 'todo' },
  priority: { type: 'string', enum: TASK_PRIORITIES, default: 'medium' },
  dueDate: { type: 'string', date: true },
  businessId: { ...ID_RULE },
  projectId: { ...ID_RULE },
  owner: { type: 'string', maxLength: 120 },
  recurrence: { type: 'string', enum: TASK_RECURRENCES, default: 'none' },
  dependencies: { type: 'array', maxItems: 25, items: { ...ID_RULE }, default: [] },
  blockers: { type: 'array', maxItems: 25, items: { type: 'string', maxLength: 200 }, default: [] },
  notes: { type: 'string', maxLength: 2000 },
  path: { ...PATH_RULE }
};

export const taskUpdateSchema = {
  name: { type: 'string', maxLength: 300 },
  status: { type: 'string', enum: TASK_STATUSES },
  priority: { type: 'string', enum: TASK_PRIORITIES },
  dueDate: { type: 'string', date: true, allowEmpty: true },
  businessId: { ...ID_RULE },
  projectId: { ...ID_RULE },
  owner: { type: 'string', maxLength: 120 },
  recurrence: { type: 'string', enum: TASK_RECURRENCES },
  dependencies: { type: 'array', maxItems: 25, items: { ...ID_RULE } },
  blockers: { type: 'array', maxItems: 25, items: { type: 'string', maxLength: 200 } }
};

export const taskQuerySchema = {
  view: { type: 'string', enum: ['all', 'today', 'overdue', 'upcoming', 'completed', 'recurring', 'blocked'], default: 'all' },
  status: { type: 'string', enum: TASK_STATUSES },
  priority: { type: 'string', enum: TASK_PRIORITIES },
  projectId: { ...ID_RULE },
  businessId: { ...ID_RULE },
  search: { type: 'string', maxLength: 200 }
};

export const operationProposalSchema = {
  action: { type: 'string', required: true, enum: OPERATION_ACTIONS },
  path: { ...PATH_RULE, required: true },
  destinationPath: { ...PATH_RULE },
  content: { type: 'string', maxLength: 500000, trim: false, allowEmpty: true },
  expectedSha: { type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9]+$/ },
  revision: { type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9]+$/ },
  reason: { type: 'string', maxLength: 500, default: 'Manual operation' },
  message: { type: 'string', maxLength: 300 },
  underHeading: { type: 'string', maxLength: 200 },
  conversationId: { type: 'string', maxLength: 128 },
  sources: { type: 'array', maxItems: 30, items: { type: 'object', schema: { path: { ...PATH_RULE, required: true }, sha: { type: 'string', maxLength: 100 }, title: { type: 'string', maxLength: 300 }, reason: { type: 'string', maxLength: 300 } } }, default: [] }
};

export const operationExecuteSchema = {
  confirmDestructive: { type: 'boolean', default: false },
  confirmPath: { ...PATH_RULE }
};

export const operationRejectSchema = {
  reason: { type: 'string', maxLength: 500, default: 'Rejected by owner' }
};

/** Shape NVIDIA is allowed to return for a proposed operation. */
export const modelOperationSchema = {
  action: { type: 'string', required: true, enum: OPERATION_ACTIONS },
  path: { ...PATH_RULE, required: true },
  destinationPath: { ...PATH_RULE },
  content: { type: 'string', maxLength: 200000, trim: false, allowEmpty: true },
  underHeading: { type: 'string', maxLength: 200 },
  reason: { type: 'string', maxLength: 500, default: 'Proposed from conversation' }
};

export const conversationCreateSchema = {
  title: { type: 'string', maxLength: 200, default: 'New conversation' },
  scope: {
    type: 'object',
    default: { type: 'vault', ids: [] },
    schema: {
      type: { type: 'string', enum: CONVERSATION_SCOPES, default: 'vault' },
      ids: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 400 }, default: [] }
    }
  }
};

export const conversationMessageSchema = {
  content: { type: 'string', required: true, maxLength: 8000 },
  allowOperations: { type: 'boolean', default: false },
  stream: { type: 'boolean', default: false }
};

export const memoryProposalSchema = {
  statement: { type: 'string', required: true, maxLength: 1000 },
  type: { type: 'string', enum: MEMORY_TYPES, default: 'fact' },
  sources: { type: 'array', maxItems: 20, items: { ...PATH_RULE }, default: [] },
  conversationId: { type: 'string', maxLength: 128 },
  targetPath: { ...PATH_RULE },
  confidence: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' }
};

export const memoryUpdateSchema = {
  statement: { type: 'string', maxLength: 1000 },
  type: { type: 'string', enum: MEMORY_TYPES }
};

export const inboxCaptureSchema = {
  content: { type: 'string', required: true, maxLength: 4000 },
  kind: { type: 'string', enum: INBOX_KINDS, default: 'unclassified' }
};

export const searchQuerySchema = {
  q: { type: 'string', required: true, maxLength: 200 },
  scope: { type: 'string', maxLength: 400, default: '' },
  limit: { type: 'number', default: 20 }
};

export const vaultReadQuerySchema = {
  path: { ...PATH_RULE, required: true },
  ref: { type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9._/-]+$/ }
};

export const vaultTreeQuerySchema = {
  path: { type: 'string', maxLength: 400, pattern: /^[A-Za-z0-9._/-]*$/, allowEmpty: true, default: '' },
  depth: { type: 'number', default: 3 }
};

const REVISION_RULE = { type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9]+$/ };
const CONTENT_RULE = { type: 'string', maxLength: 500000, trim: false, allowEmpty: true };
const REASON_RULE = { type: 'string', maxLength: 500, default: 'Manual operation' };
const MESSAGE_RULE = { type: 'string', maxLength: 300 };

export const vaultCreateSchema = {
  path: { ...PATH_RULE, required: true },
  content: { ...CONTENT_RULE, required: true },
  reason: REASON_RULE,
  message: MESSAGE_RULE
};

export const vaultReplaceSchema = {
  path: { ...PATH_RULE, required: true },
  content: { ...CONTENT_RULE, required: true },
  expectedSha: REVISION_RULE,
  revision: REVISION_RULE,
  reason: REASON_RULE,
  message: MESSAGE_RULE
};

export const vaultAppendSchema = {
  path: { ...PATH_RULE, required: true },
  content: { type: 'string', required: true, maxLength: 20000, trim: false },
  underHeading: { type: 'string', maxLength: 200 },
  expectedSha: REVISION_RULE,
  revision: REVISION_RULE,
  reason: REASON_RULE,
  message: MESSAGE_RULE
};

export const vaultMoveSchema = {
  path: { ...PATH_RULE, required: true },
  destinationPath: { ...PATH_RULE, required: true },
  expectedSha: REVISION_RULE,
  revision: REVISION_RULE,
  reason: REASON_RULE,
  message: MESSAGE_RULE
};

export const vaultArchiveSchema = {
  path: { ...PATH_RULE, required: true },
  destinationPath: { ...PATH_RULE },
  expectedSha: REVISION_RULE,
  revision: REVISION_RULE,
  reason: REASON_RULE,
  message: MESSAGE_RULE
};

export const vaultDeleteSchema = {
  path: { ...PATH_RULE, required: true },
  expectedSha: REVISION_RULE,
  revision: REVISION_RULE,
  reason: REASON_RULE,
  message: MESSAGE_RULE
};

export const dailyAppendSchema = {
  content: { type: 'string', required: true, maxLength: 2000 },
  section: { type: 'string', maxLength: 100, default: 'Notes' }
};

export const knowledgeQuerySchema = {
  path: { ...PATH_RULE, required: true }
};

export const memoryApproveSchema = {
  statement: { type: 'string', maxLength: 1000 },
  type: { type: 'string', enum: MEMORY_TYPES }
};

export const restoreSchema = {
  path: { ...PATH_RULE, required: true },
  revision: { type: 'string', required: true, maxLength: 100, pattern: /^[A-Za-z0-9]+$/ },
  expectedSha: { type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9]+$/ },
  reason: { type: 'string', maxLength: 500, default: 'Restore previous revision' }
};

export const planningProposalSchema = {
  goal: { type: 'string', maxLength: 500, default: 'Plan today' }
};

export const reportQuerySchema = {
  type: { type: 'string', enum: ['daily', 'weekly', 'business', 'project', 'activity'], default: 'daily' },
  id: { type: 'string', maxLength: 128 },
  narrative: { type: 'boolean', default: false }
};

export { PATH_RULE, ID_RULE };
