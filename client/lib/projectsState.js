/**
 * Maps an API response for GET /projects onto the view states required by the
 * specification: dashboard, empty, and configuration error.
 *
 * A configured Vault that has no registry file yet is an empty Vault, not a
 * configuration error, so the two must not collapse into one message.
 */
export function resolveProjectsState({ ok, payload } = {}) {
  const code = payload?.error?.code;

  if (code === 'VAULT_NOT_CONFIGURED') {
    return { status: 'unconfigured', projects: [] };
  }

  if (code === 'VAULT_FILE_NOT_FOUND') {
    return { status: 'empty', projects: [], reason: 'missing-registry' };
  }

  if (!ok || payload?.success !== true) {
    return { status: 'error', projects: [] };
  }

  const projects = payload?.data?.projects ?? [];
  return projects.length
    ? { status: 'ready', projects }
    : { status: 'empty', projects: [], reason: 'no-projects' };
}
