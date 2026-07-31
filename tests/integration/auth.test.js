import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  OWNER_EMAIL,
  OWNER_PASSWORD,
  createTestApp,
  extractCookie,
  signIn,
  writeEnabled
} from '../helpers/testApp.js';

describe('authentication', () => {
  it('exposes public health and auth status without a session', async () => {
    const { app } = createTestApp();

    const health = await request(app).get('/api/v1/health');
    const status = await request(app).get('/api/v1/auth/status');

    expect(health.status).toBe(200);
    expect(status.status).toBe(200);
    expect(status.body.data).toMatchObject({ authEnabled: true, authConfigured: true, authenticated: false });
    expect(JSON.stringify(status.body)).not.toContain(OWNER_PASSWORD);
  });

  it('refuses private reads without a session', async () => {
    const { app } = createTestApp();

    for (const path of ['/api/v1/projects', '/api/v1/tasks', '/api/v1/vault/tree', '/api/v1/memory', '/api/v1/activity']) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_REQUIRED');
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('refuses mutations without a session', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });

    const response = await request(app).post('/api/v1/tasks').send({ name: 'Unauthorized task' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('signs in the owner and issues an httpOnly session cookie', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.principal).toMatchObject({ role: 'owner', email: OWNER_EMAIL });

    const cookies = response.headers['set-cookie'];
    const session = cookies.find((cookie) => cookie.startsWith('nexus_session='));
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(cookies.find((cookie) => cookie.startsWith('nexus_csrf='))).not.toMatch(/HttpOnly/i);
  });

  it('rejects a wrong password without revealing which field failed', async () => {
    const { app } = createTestApp();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: 'wrong-password' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.body.error.message).toBe('Email or password is incorrect');
  });

  it('validates the login payload', async () => {
    const { app } = createTestApp();
    const response = await request(app).post('/api/v1/auth/login').send({ email: '' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.fields.map((field) => field.field)).toContain('password');
  });

  it('reports when owner credentials are not configured', async () => {
    const { app } = createTestApp({ environment: { OWNER_EMAIL: '', OWNER_PASSWORD_HASH: '' } });

    const status = await request(app).get('/api/v1/auth/status');
    expect(status.body.data.authConfigured).toBe(false);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.test', password: 'whatever' });
    expect(login.status).toBe(503);
    expect(login.body.error.code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('allows an authenticated read and reports the session', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const session = await agent.get('/api/v1/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.data.principal.email).toBe(OWNER_EMAIL);

    const projects = await agent.get('/api/v1/projects');
    expect(projects.status).toBe(200);
    expect(projects.body.data.projects[0].slug).toBe('nexus');
  });

  it('ends the session on logout', async () => {
    const { app } = createTestApp();
    const { agent, csrf } = await signIn(app);

    const logout = await agent.post('/api/v1/auth/logout').set('x-csrf-token', csrf);
    expect(logout.status).toBe(200);

    const afterLogout = await agent.get('/api/v1/projects');
    expect(afterLogout.status).toBe(401);
  });

  it('rate-limits repeated failed sign-in attempts', async () => {
    const { app } = createTestApp({ environment: { AUTH_RATE_LIMIT_MAX_REQUESTS: '3' } });

    const attempts = [];
    for (let index = 0; index < 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      attempts.push(await request(app).post('/api/v1/auth/login').send({ email: OWNER_EMAIL, password: 'wrong' }));
    }

    expect(attempts.at(-1).status).toBe(429);
    expect(attempts.at(-1).body.error.code).toBe('RATE_LIMITED');
  });
});

describe('CSRF protection', () => {
  it('rejects a mutation without the CSRF header', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent } = await signIn(app);

    const response = await agent.post('/api/v1/tasks').send({ name: 'No CSRF token' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a mutation whose CSRF header does not match the cookie', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent } = await signIn(app);

    const response = await agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', 'a-forged-token')
      .send({ name: 'Forged token' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('does not require a CSRF token for reads', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);
    expect((await agent.get('/api/v1/projects')).status).toBe(200);
  });

  it('accepts a mutation carrying the matching token', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { send } = await signIn(app);

    const response = await send('post', '/api/v1/tasks').send({ name: 'Valid CSRF token' });
    expect(response.status).toBe(201);
  });
});

describe('session tokens across instances', () => {
  it('does not accept a session minted with a different secret', async () => {
    const first = createTestApp({ environment: { SESSION_SECRET: 'secret-one' } });
    const second = createTestApp({ environment: { SESSION_SECRET: 'secret-two' } });

    const login = await request(first.app)
      .post('/api/v1/auth/login')
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD });
    const token = extractCookie(login.headers['set-cookie'], 'nexus_session');

    const response = await request(second.app).get('/api/v1/projects').set('Cookie', `nexus_session=${token}`);
    expect(response.status).toBe(401);
  });
});

describe('development mode with authentication disabled', () => {
  it('permits reads but still refuses writes without configuration', async () => {
    const { app } = createTestApp({ environment: { AUTH_ENABLED: 'false', WRITE_OPERATIONS_ENABLED: 'true' } });

    expect((await request(app).get('/api/v1/projects')).status).toBe(200);

    const write = await request(app).post('/api/v1/tasks').send({ name: 'Should be refused' });
    expect(write.status).toBe(503);
    expect(write.body.error.code).toBe('VAULT_WRITE_DISABLED');
  });
});
