/**
 * Maps an API response for GET /projects onto explicit view states.
 * Configuration, missing-registry, upstream, and unexpected failures stay
 * separate so the UI does not give misleading recovery instructions.
 */
export function resolveProjectsState({ ok, payload } = {}) {
  const code = payload?.error?.code;

  if (code === 'VAULT_NOT_CONFIGURED') {
    return { status: 'unconfigured', projects: [] };
  }

  if (code === 'VAULT_FILE_NOT_FOUND') {
    return { status: 'empty', projects: [], reason: 'missing-registry' };
  }

  if (code === 'VAULT_UPSTREAM_ERROR') {
    return { status: 'upstream-error', projects: [] };
  }

  if (!ok || payload?.success !== true) {
    return { status: 'error', projects: [] };
  }

  const projects = payload?.data?.projects ?? [];
  return projects.length
    ? { status: 'ready', projects }
    : { status: 'empty', projects: [], reason: 'no-projects' };
}
