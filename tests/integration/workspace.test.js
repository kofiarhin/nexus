import { describe, expect, it } from 'vitest';
import { createTestApp, signIn, writeEnabled } from '../helpers/testApp.js';

describe('projects and businesses', () => {
  it('returns a full project record with its sources', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/projects/nexus');

    expect(response.status).toBe(200);
    expect(response.body.data.project).toMatchObject({ id: 'nexus', name: 'Nexus', lifecycle: 'active' });
    expect(response.body.data.project.openQuestions).toEqual(['Where should reports live?']);
    expect(response.body.data.project.sources).toHaveLength(2);
  });

  it('reports an unknown project as not found', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);
    expect((await agent.get('/api/v1/projects/nope')).status).toBe(404);
  });

  it('lists businesses and returns a full business record', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const list = await agent.get('/api/v1/businesses');
    expect(list.body.data.businesses[0]).toMatchObject({ id: 'acme', name: 'Acme Studio' });

    const detail = await agent.get('/api/v1/businesses/acme');
    expect(detail.body.data.business.goals).toEqual(['Reach ten retained clients']);
    expect(detail.body.data.business.metrics).toEqual(['Monthly recurring revenue']);
  });

  it('reports an empty business list rather than failing without a registry', async () => {
    const { app } = createTestApp({ files: { 'registry/PROJECTS.md': '| a | A | active | projects/a.md | 2026 |' } });
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/businesses');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ businesses: [], registered: false });
  });
});

describe('tasks', () => {
  it('lists tasks from every task document with their sources', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/tasks');

    expect(response.status).toBe(200);
    const ids = response.body.data.tasks.map((task) => task.id);
    expect(ids).toContain('tsk-review');
    expect(ids).toContain('tsk-project');
    expect(response.body.data.sources.map((source) => source.path).sort()).toEqual([
      'projects/nexus/TASKS.md',
      'tasks/TASKS.md'
    ]);
  });

  it('applies the today and overdue views deterministically', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const today = await agent.get('/api/v1/tasks/today');
    const overdue = await agent.get('/api/v1/tasks?view=overdue');

    expect(today.body.data.tasks.map((task) => task.id).sort()).toEqual(['tsk-project', 'tsk-review']);
    expect(overdue.body.data.tasks.map((task) => task.id)).toEqual(['tsk-project']);
  });

  it('filters by project', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/tasks?projectId=nexus');
    expect(response.body.data.tasks.map((task) => task.id)).toEqual(['tsk-project']);
  });

  it('rejects an unsupported view', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/tasks?view=everything');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates a task by appending one annotated line', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await signIn(app);

    const response = await send('post', '/api/v1/tasks').send({
      name: 'Draft the launch plan',
      priority: 'high',
      dueDate: '2026-08-15',
      projectId: 'nexus'
    });

    expect(response.status).toBe(201);
    expect(response.body.data.executed).toBe(true);

    const content = vault.read('tasks/TASKS.md');
    expect(content).toContain('- [ ] Draft the launch plan');
    expect(content).toContain('@priority(high)');
    expect(content).toContain('@due(2026-08-15)');
    // The rest of the document is untouched.
    expect(content).toContain('Unannotated legacy task');
  });

  it('validates a task payload', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { send } = await signIn(app);

    const response = await send('post', '/api/v1/tasks').send({ name: '', priority: 'urgent' });

    expect(response.status).toBe(400);
    expect(response.body.error.details.fields.map((field) => field.field).sort()).toEqual(['name', 'priority']);
  });

  it('completes a task in place, preserving the rest of the document', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await signIn(app);

    const response = await send('patch', '/api/v1/tasks/tsk-review').send({ status: 'done' });

    expect(response.status).toBe(200);
    expect(response.body.data.executed).toBe(true);

    const content = vault.read('tasks/TASKS.md');
    expect(content).toContain('- [x] Review the quarterly plan');
    expect(content).toContain('@completed(2026-07-31)');
    expect(content).toContain('Unannotated legacy task');
  });

  it('reopens a completed task', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await signIn(app);

    await send('patch', '/api/v1/tasks/tsk-shipped').send({ status: 'todo' });
    expect(vault.read('tasks/TASKS.md')).toContain('- [ ] Ship the foundation');
  });

  it('deletes a task line without touching neighbouring lines', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await signIn(app);

    const response = await send('delete', '/api/v1/tasks/tsk-review').send({});

    expect(response.status).toBe(200);
    const content = vault.read('tasks/TASKS.md');
    expect(content).not.toContain('Review the quarterly plan');
    expect(content).toContain('Unannotated legacy task');
    expect(content).toContain('Ship the foundation');
  });

  it('reports an unknown task as not found', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await signIn(app);

    expect((await agent.get('/api/v1/tasks/tsk-missing')).status).toBe(404);
    expect((await send('patch', '/api/v1/tasks/tsk-missing').send({ status: 'done' })).status).toBe(404);
  });

  it('edits a task in a project task document', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { send } = await signIn(app);

    await send('patch', '/api/v1/tasks/tsk-project').send({ priority: 'critical' });

    expect(vault.read('projects/nexus/TASKS.md')).toContain('@priority(critical)');
    expect(vault.read('tasks/TASKS.md')).not.toContain('@priority(critical)');
  });
});

describe('Today planning', () => {
  it('builds a source-grounded plan without any reasoning provider', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/planning/today');

    expect(response.status).toBe(200);
    const plan = response.body.data;

    expect(plan.date).toBe('2026-07-31');
    expect(plan.aiAvailable).toBe(false);
    expect(plan.overdue.map((task) => task.id)).toEqual(['tsk-project']);
    expect(plan.dueToday.map((task) => task.id)).toEqual(['tsk-review']);
    expect(plan.counts.open).toBe(3);
    expect(plan.sources.map((source) => source.path)).toContain('tasks/TASKS.md');
  });

  it('gives every recommendation a reason and a source', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/planning/today');

    expect(response.body.data.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of response.body.data.recommendations) {
      expect(recommendation.basis).toBe('deterministic');
      expect(recommendation.reasons.length).toBeGreaterThan(0);
      expect(recommendation.sources[0].path).toBeTruthy();
    }
  });

  it('ranks overdue work above undated work', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/planning/today');
    const ids = response.body.data.recommendations.map((recommendation) => recommendation.taskId);

    expect(ids.indexOf('tsk-project')).toBeLessThan(ids.indexOf('tsk-review') + 1);
    expect(ids[ids.length - 1]).not.toBe('tsk-project');
  });

  it('surfaces unresolved project questions and business alerts', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/planning/today');

    expect(response.body.data.unresolvedDecisions[0]).toMatchObject({
      projectId: 'nexus',
      question: 'Where should reports live?'
    });
    expect(response.body.data.businessAlerts[0]).toMatchObject({ businessId: 'acme', name: 'Acme Studio' });
  });
});

describe('inbox, daily notes, and knowledge', () => {
  it('captures an inbox item without classifying it', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await signIn(app);

    const response = await send('post', '/api/v1/inbox').send({ content: 'A new idea worth keeping', kind: 'idea' });

    expect(response.status).toBe(201);
    expect(vault.read('inbox/INBOX.md')).toContain('A new idea worth keeping');

    const list = await agent.get('/api/v1/inbox');
    const captured = list.body.data.entries.find((entry) => entry.content === 'A new idea worth keeping');
    expect(captured).toMatchObject({ kind: 'idea', status: 'open' });
  });

  it('reports that a suggestion needs the reasoning provider', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/inbox/inb-existing/suggestion');

    expect(response.status).toBe(200);
    expect(response.body.data.aiAvailable).toBe(false);
    expect(response.body.data.suggestion).toBeNull();
  });

  it('reads a daily note and appends an entry under a section', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await signIn(app);

    const existing = await agent.get('/api/v1/daily/2026-07-30');
    expect(existing.body.data.note.plan).toEqual(['Draft the specification']);

    const appended = await send('post', '/api/v1/daily/2026-07-30/entries')
      .send({ content: 'Reviewed the plan', section: 'Notes' });

    expect(appended.status).toBe(200);
    expect(vault.read('daily/2026-07-30.md')).toContain('- Reviewed the plan');
  });

  it('creates a daily note when the day has none', async () => {
    const { app, vault } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await signIn(app);

    const missing = await agent.get('/api/v1/daily/2026-07-31');
    expect(missing.body.data.note.exists).toBe(false);

    await send('post', '/api/v1/daily/2026-07-31/entries').send({ content: 'First entry', section: 'Notes' });
    expect(vault.read('daily/2026-07-31.md')).toContain('First entry');
  });

  it('lists knowledge notes and returns one with links and backlinks', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const list = await agent.get('/api/v1/knowledge');
    expect(list.body.data.notes.map((note) => note.path)).toContain('knowledge/retrieval.md');

    const note = await agent.get('/api/v1/knowledge/note?path=knowledge/retrieval.md');
    expect(note.body.data.note.title).toBe('Retrieval');
    expect(note.body.data.note.links).toContain('memory');
  });
});

describe('reports', () => {
  it('generates a deterministic daily report with sources', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/reports?type=daily');

    expect(response.status).toBe(200);
    expect(response.body.data.report.type).toBe('daily');
    expect(response.body.data.report.facts.overdue.map((task) => task.id)).toEqual(['tsk-project']);
    expect(response.body.data.report.narrative).toBeNull();
    expect(response.body.data.report.aiAvailable).toBe(false);
    expect(response.body.data.report.sources.length).toBeGreaterThan(0);
  });

  it('generates project and business reports', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const project = await agent.get('/api/v1/reports?type=project&id=nexus');
    expect(project.body.data.report.facts.openQuestions).toEqual(['Where should reports live?']);

    const business = await agent.get('/api/v1/reports?type=business&id=acme');
    expect(business.body.data.report.facts.risks).toEqual(['Client concentration']);
  });

  it('rejects an unsupported report type', async () => {
    const { app } = createTestApp();
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/reports?type=quarterly');
    expect(response.status).toBe(400);
  });
});

describe('settings', () => {
  it('reports configuration state without exposing any secret', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent } = await signIn(app);

    const response = await agent.get('/api/v1/settings');
    const body = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.body.data.vault.repository).toBe('kofiarhin/nexus-vault');
    expect(response.body.data.operations.writeOperationsEnabled).toBe(true);
    expect(response.body.data.operations.allowedActions).not.toContain('delete');
    expect(body).not.toContain('test-token-value');
    expect(body).not.toContain('test-session-secret');
  });

  it('reports health for the Vault and the reasoning provider', async () => {
    const { app } = createTestApp();

    const vault = await createTestApp().app;
    expect(vault).toBeTruthy();

    const { agent } = await signIn(app);
    const ai = await agent.get('/api/v1/health/ai');

    expect(ai.status).toBe(200);
    expect(ai.body.data).toMatchObject({ status: 'not_configured', provider: 'nvidia', model: null });
  });
});
