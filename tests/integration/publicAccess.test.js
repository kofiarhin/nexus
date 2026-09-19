import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, writeEnabled } from '../helpers/testApp.js';

describe('public MVP access', () => {
  it('does not expose authentication routes', async () => {
    const { app } = createTestApp();

    const status = await request(app).get('/api/v1/auth/status');
    const login = await request(app).post('/api/v1/auth/login').send({});

    expect(status.status).toBe(404);
    expect(login.status).toBe(404);
  });

  it('serves workspace reads without a session', async () => {
    const { app } = createTestApp();

    const response = await request(app).get('/api/v1/projects');

    expect(response.status).toBe(200);
    expect(response.body.data.projects[0].slug).toBe('nexus');
  });

  it('allows write-enabled mutations without a session or CSRF token', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });

    const response = await request(app).post('/api/v1/tasks').send({ name: 'Public MVP task' });

    expect(response.status).toBe(201);
    expect(response.body.data.task.name).toBe('Public MVP task');
  });
});
