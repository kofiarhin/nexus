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

  it('lists projects without AI', async () => {
    const markdown = '| Project | Summary |\n| --- | --- |\n| [Alpha](projects/alpha.md) | First project |';
    const fetchImpl = async () => new Response(JSON.stringify({
      content: Buffer.from(markdown).toString('base64')
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const response = await request(createApp({ environment, fetchImpl })).get('/api/v1/projects');
    expect(response.status).toBe(200);
    expect(response.body.data.projects[0].slug).toBe('alpha');
  });

  it('returns a controlled error when the Vault is not configured', async () => {
    const response = await request(createApp({ environment: { PORT: '5000' } })).get('/api/v1/projects');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('VAULT_NOT_CONFIGURED');
  });
});
