import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api.js';

/** Query keys are namespaced so a mutation can invalidate exactly what changed. */
export const keys = {
  settings: ['settings'],
  health: ['health'],
  projects: ['projects'],
  project: (id) => ['projects', id],
  businesses: ['businesses'],
  business: (id) => ['businesses', id],
  tasks: (query) => ['tasks', query ?? {}],
  taskSummary: ['tasks', 'summary'],
  planningToday: ['planning', 'today'],
  vaultTree: (path) => ['vault', 'tree', path ?? ''],
  vaultFile: (path) => ['vault', 'file', path],
  vaultHistory: (path) => ['vault', 'history', path],
  search: (query) => ['search', query],
  conversations: ['conversations'],
  conversation: (id) => ['conversations', id],
  memory: ['memory'],
  operations: ['operations'],
  operation: (id) => ['operations', id],
  activity: ['activity'],
  inbox: ['inbox'],
  daily: ['daily'],
  dailyNote: (date) => ['daily', date],
  knowledge: ['knowledge'],
  knowledgeNote: (path) => ['knowledge', path],
  report: (query) => ['reports', query]
};

const toQueryString = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
};

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => apiRequest('/settings') });

export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: () => apiRequest('/projects') });

export const useProject = (id) => useQuery({
  queryKey: keys.project(id),
  queryFn: () => apiRequest(`/projects/${encodeURIComponent(id)}`),
  enabled: Boolean(id)
});

export const useBusinesses = () => useQuery({ queryKey: keys.businesses, queryFn: () => apiRequest('/businesses') });

export const useBusiness = (id) => useQuery({
  queryKey: keys.business(id),
  queryFn: () => apiRequest(`/businesses/${encodeURIComponent(id)}`),
  enabled: Boolean(id)
});

export const useTasks = (query) => useQuery({
  queryKey: keys.tasks(query),
  queryFn: () => apiRequest(`/tasks${toQueryString(query)}`)
});

export const usePlanningToday = () => useQuery({
  queryKey: keys.planningToday,
  queryFn: () => apiRequest('/planning/today')
});

export const useVaultTree = (path) => useQuery({
  queryKey: keys.vaultTree(path),
  queryFn: () => apiRequest(`/vault/tree${toQueryString({ path })}`)
});

export const useVaultFile = (path) => useQuery({
  queryKey: keys.vaultFile(path),
  queryFn: () => apiRequest(`/vault/files${toQueryString({ path })}`),
  enabled: Boolean(path)
});

export const useVaultHistory = (path) => useQuery({
  queryKey: keys.vaultHistory(path),
  queryFn: () => apiRequest(`/vault/files/history${toQueryString({ path })}`),
  enabled: Boolean(path)
});

export const useSearch = (query) => useQuery({
  queryKey: keys.search(query),
  queryFn: () => apiRequest(`/search${toQueryString(query)}`),
  enabled: Boolean(query?.q)
});

export const useConversations = () => useQuery({
  queryKey: keys.conversations,
  queryFn: () => apiRequest('/conversations')
});

export const useConversation = (id) => useQuery({
  queryKey: keys.conversation(id),
  queryFn: () => apiRequest(`/conversations/${encodeURIComponent(id)}`),
  enabled: Boolean(id)
});

export const useMemory = () => useQuery({ queryKey: keys.memory, queryFn: () => apiRequest('/memory') });

export const useOperations = () => useQuery({ queryKey: keys.operations, queryFn: () => apiRequest('/operations') });

export const useOperation = (id) => useQuery({
  queryKey: keys.operation(id),
  queryFn: () => apiRequest(`/operations/${encodeURIComponent(id)}`),
  enabled: Boolean(id)
});

export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => apiRequest('/activity') });

export const useInbox = () => useQuery({ queryKey: keys.inbox, queryFn: () => apiRequest('/inbox') });

export const useDailyNotes = () => useQuery({ queryKey: keys.daily, queryFn: () => apiRequest('/daily') });

export const useDailyNote = (date) => useQuery({
  queryKey: keys.dailyNote(date),
  queryFn: () => apiRequest(`/daily/${encodeURIComponent(date)}`),
  enabled: Boolean(date)
});

export const useKnowledge = () => useQuery({ queryKey: keys.knowledge, queryFn: () => apiRequest('/knowledge') });

export const useKnowledgeNote = (path) => useQuery({
  queryKey: keys.knowledgeNote(path),
  queryFn: () => apiRequest(`/knowledge/note${toQueryString({ path })}`),
  enabled: Boolean(path)
});

export const useReport = (query) => useQuery({
  queryKey: keys.report(query),
  queryFn: () => apiRequest(`/reports${toQueryString(query)}`)
});

/**
 * Mutation helper that invalidates the affected query keys on success.
 * Operations and activity are always refreshed because every mutation records
 * an audit event.
 */
export function useApiMutation({ request, invalidates = [] }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      for (const key of [...invalidates, keys.operations, keys.activity]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }
  });
}

export const useCreateTask = () => useApiMutation({
  request: (body) => apiRequest('/tasks', { method: 'POST', body }),
  invalidates: [['tasks'], keys.planningToday]
});

export const useUpdateTask = () => useApiMutation({
  request: ({ taskId, ...body }) => apiRequest(`/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body }),
  invalidates: [['tasks'], keys.planningToday]
});

export const useDeleteTask = () => useApiMutation({
  request: ({ taskId }) => apiRequest(`/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
  invalidates: [['tasks'], keys.planningToday]
});

export const useCaptureInbox = () => useApiMutation({
  request: (body) => apiRequest('/inbox', { method: 'POST', body }),
  invalidates: [keys.inbox]
});

export const usePromoteInboxEntry = () => useApiMutation({
  request: ({ entryId, destination }) => apiRequest(`/inbox/${encodeURIComponent(entryId)}/promote`, {
    method: 'POST',
    body: { destination }
  }),
  invalidates: [keys.inbox]
});

export const useDeleteInboxEntry = () => useApiMutation({
  request: ({ entryId }) => apiRequest(`/inbox/${encodeURIComponent(entryId)}`, { method: 'DELETE' }),
  invalidates: [keys.inbox]
});

export const useAppendDailyEntry = () => useApiMutation({
  request: ({ date, ...body }) => apiRequest(`/daily/${encodeURIComponent(date)}/entries`, { method: 'POST', body }),
  invalidates: [['daily']]
});

export const useCreateConversation = () => useApiMutation({
  request: (body) => apiRequest('/conversations', { method: 'POST', body }),
  invalidates: [keys.conversations]
});

export const useSendMessage = () => useApiMutation({
  request: ({ conversationId, ...body }) => apiRequest(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', body }
  ),
  invalidates: [keys.conversations]
});

export const useProposeMemory = () => useApiMutation({
  request: (body) => apiRequest('/memory/proposals', { method: 'POST', body }),
  invalidates: [keys.memory]
});

export const useApproveMemory = () => useApiMutation({
  request: ({ proposalId, ...body }) => apiRequest(
    `/memory/proposals/${encodeURIComponent(proposalId)}/approve`,
    { method: 'POST', body }
  ),
  invalidates: [keys.memory]
});

export const useRejectMemory = () => useApiMutation({
  request: ({ proposalId, reason }) => apiRequest(
    `/memory/proposals/${encodeURIComponent(proposalId)}/reject`,
    { method: 'POST', body: { reason } }
  ),
  invalidates: [keys.memory]
});

export const useUpdateMemory = () => useApiMutation({
  request: ({ memoryId, ...body }) => apiRequest(`/memory/${encodeURIComponent(memoryId)}`, { method: 'PATCH', body }),
  invalidates: [keys.memory]
});

export const useDeleteMemory = () => useApiMutation({
  request: ({ memoryId }) => apiRequest(`/memory/${encodeURIComponent(memoryId)}`, { method: 'DELETE' }),
  invalidates: [keys.memory]
});

export const useProposeOperation = () => useApiMutation({
  request: (body) => apiRequest('/operations/proposals', { method: 'POST', body })
});

export const useApproveOperation = () => useApiMutation({
  request: ({ operationId }) => apiRequest(`/operations/${encodeURIComponent(operationId)}/approve`, { method: 'POST' })
});

export const useRejectOperation = () => useApiMutation({
  request: ({ operationId, reason }) => apiRequest(
    `/operations/${encodeURIComponent(operationId)}/reject`,
    { method: 'POST', body: { reason } }
  )
});

export const useExecuteOperation = () => useApiMutation({
  request: ({ operationId, confirmDestructive = false, idempotencyKey }) => apiRequest(
    `/operations/${encodeURIComponent(operationId)}/execute`,
    { method: 'POST', body: { confirmDestructive }, idempotencyKey }
  ),
  invalidates: [['vault'], ['tasks'], keys.memory, keys.inbox, ['daily'], keys.planningToday]
});

export const useVaultMutation = (endpoint, method = 'POST') => useApiMutation({
  request: (body) => apiRequest(endpoint, { method, body }),
  invalidates: [['vault'], ['tasks'], keys.planningToday, keys.knowledge]
});

/**
 * Awaits a mutation without producing an unhandled rejection.
 *
 * The failure stays on the mutation's `error` so the page renders the specific
 * permission, validation, or conflict state; this only stops the rejection
 * escaping an event handler.
 */
export async function runMutation(mutation, variables) {
  try {
    return await mutation.mutateAsync(variables);
  } catch {
    return null;
  }
}

export { toQueryString };
