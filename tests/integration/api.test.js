import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';

// These cases cover Vault error normalization and the response envelope.
const environment = {
  PORT: '5000',
  CLIENT_URL: 'http://localhost:5173',
  LOG_ENABLED: 'false',
  GITHUB_TOKEN: 'token',
  GITHUB_OWNER: 'kofiarhin',
  GITHUB_VAULT_REPO: 'nexus-vault',
  GITHUB_VAULT_BRANCH: 'main'
};

const unconfiguredEnvironment = { PORT: '5000', LOG_ENABLED: 'false' };

const projectRegistry = '| Project | Summary |\n| --- | --- |\n| [Alpha](projects/alpha.md) | First project |';

function githubResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('Nexus API', () => {
  it('reports health with the standard envelope and request ID', async () => {
    const response = await request(createApp({ environment })).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { status: 'ok', service: 'nexus-api' },
      requestId: response.headers['x-request-id']
    });
  });

  it('preserves a supplied request ID', async () => {
    const response = await request(createApp({ environment }))
      .get('/api/v1/health')
      .set('x-request-id', 'supplied-id');

    expect(response.headers['x-request-id']).toBe('supplied-id');
    expect(response.body.requestId).toBe('supplied-id');
  });

  it('returns a request ID on CORS preflight requests', async () => {
    const response = await request(createApp({ environment }))
      .options('/api/v1/projects')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');

    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns a controlled malformed JSON error with a request ID', async () => {
    const response = await request(createApp({ environment }))
      .post('/api/v1/projects')
      .set('content-type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Request body contains invalid JSON'
      },
      requestId: response.headers['x-request-id']
    });
  });

  it('reports configured Vault health without exposing credentials', async () => {
    const response = await request(createApp({ environment })).get('/api/v1/health/vault');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: 'configured',
      repository: 'kofiarhin/nexus-vault',
      branch: 'main',
      writeOperationsEnabled: false,
      destructiveOperationsEnabled: false
    });
    expect(JSON.stringify(response.body)).not.toContain(environment.GITHUB_TOKEN);
  });

  it('reports unconfigured Vault health without claiming connectivity', async () => {
    const response = await request(createApp({ environment: unconfiguredEnvironment }))
      .get('/api/v1/health/vault');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: 'not_configured',
      repository: null,
      branch: 'main',
      writeOperationsEnabled: false,
      destructiveOperationsEnabled: false
    });
  });

  it('returns NOT_FOUND with a request ID for unknown routes', async () => {
    const response = await request(createApp({ environment })).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('lists projects deterministically without AI', async () => {
    const fetchImpl = async () => githubResponse({
      content: Buffer.from(projectRegistry).toString('base64')
    });

    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(200);
    expect(response.body.data.projects).toEqual([
      {
        name: 'Alpha',
        slug: 'alpha',
        path: 'projects/alpha.md',
        summary: 'First project'
      }
    ]);
  });

  it('maps a missing Vault file to VAULT_FILE_NOT_FOUND', async () => {
    const fetchImpl = async () => githubResponse({}, 404);
    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: 'VAULT_FILE_NOT_FOUND',
      message: 'Vault file not found: registry/PROJECTS.md'
    });
  });

  it('maps upstream HTTP failures to VAULT_UPSTREAM_ERROR', async () => {
    const fetchImpl = async () => githubResponse({}, 500);
    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(502);
    expect(response.body.error).toEqual({
      code: 'VAULT_UPSTREAM_ERROR',
      message: 'GitHub Vault request failed'
    });
    expect(JSON.stringify(response.body)).not.toContain(environment.GITHUB_TOKEN);
  });

  it('maps rejected network requests to VAULT_UPSTREAM_ERROR', async () => {
    const fetchImpl = async () => {
      throw new Error('socket failure with sensitive upstream details');
    };
    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(502);
    expect(response.body.error).toEqual({
      code: 'VAULT_UPSTREAM_ERROR',
      message: 'GitHub Vault request failed'
    });
    expect(JSON.stringify(response.body)).not.toContain('socket failure');
  });

  it('maps malformed upstream JSON to VAULT_UPSTREAM_ERROR', async () => {
    const fetchImpl = async () => ({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError('invalid upstream JSON');
      }
    });
    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('VAULT_UPSTREAM_ERROR');
  });

  it('maps missing or invalid encoded content to VAULT_UPSTREAM_ERROR', async () => {
    const missingContent = await request(createApp({
      environment,
      fetchImpl: async () => githubResponse({})
    })).get('/api/v1/projects');

    const invalidContent = await request(createApp({
      environment,
      fetchImpl: async () => githubResponse({ content: '***' })
    })).get('/api/v1/projects');

    expect(missingContent.status).toBe(502);
    expect(missingContent.body.error.code).toBe('VAULT_UPSTREAM_ERROR');
    expect(invalidContent.status).toBe(502);
    expect(invalidContent.body.error.code).toBe('VAULT_UPSTREAM_ERROR');
  });

  it('supports an empty Vault registry file', async () => {
    const fetchImpl = async () => githubResponse({ content: '' });
    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(200);
    expect(response.body.data.projects).toEqual([]);
  });

  it('requests the configured branch explicitly', async () => {
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url);
      return githubResponse({ content: '' });
    };

    await request(createApp({
      environment: { ...environment, GITHUB_VAULT_BRANCH: 'release' },
      fetchImpl
    })).get('/api/v1/projects');

    expect(requested[0]).toContain('/contents/registry/PROJECTS.md');
    expect(requested[0]).toContain('ref=release');
  });

  it('returns a controlled error when the Vault is not configured', async () => {
    const response = await request(createApp({ environment: unconfiguredEnvironment })).get('/api/v1/projects');

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'VAULT_NOT_CONFIGURED',
      message: 'GitHub Vault is not configured'
    });
  });
});
