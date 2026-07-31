import { describe, expect, it } from 'vitest';
import { resolveProjectsState } from '../../client/lib/projectsState.js';

const success = (projects) => ({
  ok: true,
  payload: { success: true, data: { projects }, requestId: 'test' }
});

const failure = (code) => ({
  ok: false,
  payload: { success: false, error: { code, message: 'Safe message' }, requestId: 'test' }
});

describe('resolveProjectsState', () => {
  it('renders the dashboard when projects are returned', () => {
    const projects = [{ name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: 'First' }];
    expect(resolveProjectsState(success(projects))).toEqual({ status: 'ready', projects });
  });

  it('treats a configured Vault with no registry file as empty, not misconfigured', () => {
    expect(resolveProjectsState(failure('VAULT_FILE_NOT_FOUND'))).toEqual({
      status: 'empty',
      projects: [],
      reason: 'missing-registry'
    });
  });

  it('treats an empty registry as empty', () => {
    expect(resolveProjectsState(success([]))).toEqual({
      status: 'empty',
      projects: [],
      reason: 'no-projects'
    });
  });

  it('reports a configuration error only when the Vault is unconfigured', () => {
    expect(resolveProjectsState(failure('VAULT_NOT_CONFIGURED'))).toEqual({
      status: 'unconfigured',
      projects: []
    });
  });

  it('reports upstream failures separately from unexpected errors', () => {
    expect(resolveProjectsState(failure('VAULT_UPSTREAM_ERROR'))).toEqual({
      status: 'upstream-error',
      projects: []
    });
    expect(resolveProjectsState(failure('INTERNAL_ERROR')).status).toBe('error');
  });

  it('does not treat a malformed success payload as a dashboard', () => {
    expect(resolveProjectsState({ ok: true, payload: {} }).status).toBe('error');
    expect(resolveProjectsState().status).toBe('error');
  });
});
