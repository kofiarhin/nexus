import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';

const environment = {
  PORT: '5000',
  CLIENT_URL: 'http://localhost:5173',
  GITHUB_TOKEN: 'token',
  GITHUB_OWNER: 'kofiarhin',
  GITHUB_VAULT_REPO: 'nexus-vault',
  GITHUB_VAULT_BRANCH: 'main'
};

describe('Nexus API', () => {
  it('reports health with a request ID', async () => {
    const response = await request(createApp({ environment })).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.headers['x-request-id']).toBeTruthy();
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

  it('reports Vault configuration without exposing credentials', async () => {
    const response = await request(createApp({ environment })).get('/api/v1/health/vault');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      status: 'configured',
      repository: 'kofiarhin/nexus-vault',
      branch: 'main'
    });
    expect(JSON.stringify(response.body)).not.toContain(environment.GITHUB_TOKEN);
  });

  it('returns NOT_FOUND for unknown routes', async () => {
    const response = await request(createApp({ environment })).get('/api/v1/unknown');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('lists projects without AI', async () => {
    const markdown = '| Project | Summary |\n| --- | --- |\n| [Alpha](projects/alpha.md) | First project |';
    const fetchImpl = async () => new Response(JSON.stringify({
      content: Buffer.from(markdown).toString('base64')
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');
    expect(response.status).toBe(200);
    expect(response.body.data.projects[0].slug).toBe('alpha');
  });

  it('maps a missing Vault file to VAULT_FILE_NOT_FOUND', async () => {
    const fetchImpl = async () => new Response('{}', { status: 404 });
    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('VAULT_FILE_NOT_FOUND');
  });

  it('maps other upstream failures to VAULT_UPSTREAM_ERROR', async () => {
    const fetchImpl = async () => new Response('{}', { status: 500 });
    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('VAULT_UPSTREAM_ERROR');
    expect(JSON.stringify(response.body)).not.toContain(environment.GITHUB_TOKEN);
  });

  it('requests the configured branch explicitly', async () => {
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url);
      return new Response(JSON.stringify({ content: Buffer.from('').toString('base64') }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    await request(createApp({
      environment: { ...environment, GITHUB_VAULT_BRANCH: 'release' },
      fetchImpl
    })).get('/api/v1/projects');

    expect(requested[0]).toContain('/contents/registry/PROJECTS.md');
    expect(requested[0]).toContain('ref=release');
  });

  it('returns a controlled error when the Vault is not configured', async () => {
    const response = await request(createApp({ environment: { PORT: '5000' } })).get('/api/v1/projects');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('VAULT_NOT_CONFIGURED');
  });
});
