import { describe, expect, it } from 'vitest';
import { createTestApp, createPublicClient, writeEnabled } from '../helpers/testApp.js';
import { NVIDIA_ENVIRONMENT, createFakeNvidia } from '../helpers/fakeNvidia.js';

function createAiApp({ reply, environment = {} } = {}) {
  const nvidia = createFakeNvidia({ reply });
  const context = createTestApp({
    environment: { ...NVIDIA_ENVIRONMENT, ...writeEnabled(), ...environment },
    aiFetchImpl: nvidia.fetchImpl
  });
  return { ...context, nvidia: nvidia.state };
}

const startConversation = async (send, scope = { type: 'vault', ids: [] }) => {
  const response = await send('post', '/api/v1/conversations').send({ title: 'Test conversation', scope });
  return response.body.data.conversation;
};

describe('conversation without a reasoning provider', () => {
  it('reports that reasoning is not configured while reads keep working', async () => {
    const { app } = createTestApp({ environment: writeEnabled() });
    const { agent, send } = await createPublicClient(app);

    const conversation = await startConversation(send);
    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'What should I do today?' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AI_NOT_CONFIGURED');
    expect((await agent.get('/api/v1/planning/today')).status).toBe(200);
  });
});

describe('conversation with a reasoning provider', () => {
  it('answers with citations mapped to a bounded source manifest', async () => {
    const { app } = createAiApp({ reply: 'Nexus is active [S1] and one task is open [S3].' });
    const { send } = await createPublicClient(app);

    const conversation = await startConversation(send);
    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'What is the project status?' });

    expect(response.status).toBe(200);
    expect(response.body.data.message.content).toContain('Nexus is active');
    expect(response.body.data.message.citations.length).toBeGreaterThan(0);
    expect(response.body.data.sourceManifest.length).toBeGreaterThan(0);

    for (const source of response.body.data.sourceManifest) {
      expect(source).toMatchObject({ path: expect.any(String), reason: expect.any(String) });
      expect(source.excerpt).toBeUndefined();
    }
  });

  it('sends only bounded Vault context, never credentials', async () => {
    const { app, nvidia } = createAiApp();
    const { send } = await createPublicClient(app);

    const conversation = await startConversation(send);
    await send('post', `/api/v1/conversations/${conversation.id}/messages`).send({ content: 'Summarise the Vault' });

    const prompt = JSON.stringify(nvidia.requests[0].body);
    expect(prompt).toContain('registry/PROJECTS.md');
    expect(prompt).not.toContain('test-token-value');
    expect(prompt).not.toContain('test-nvidia-key');
  });

  it('scopes context to a single project', async () => {
    const { app, nvidia } = createAiApp();
    const { send } = await createPublicClient(app);

    const conversation = await startConversation(send, { type: 'project', ids: ['nexus'] });
    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'What is the current focus?' });

    const paths = response.body.data.sourceManifest.map((source) => source.path);
    expect(paths).toContain('projects/nexus/PROJECT.md');
    expect(paths).not.toContain('registry/BUSINESSES.md');
    expect(JSON.stringify(nvidia.requests[0].body)).not.toContain('Acme Studio');
  });

  it('scopes context to explicitly selected documents', async () => {
    const { app } = createAiApp();
    const { send } = await createPublicClient(app);

    const conversation = await startConversation(send, { type: 'document', ids: ['knowledge/retrieval.md'] });
    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Explain this note' });

    expect(response.body.data.sourceManifest.map((source) => source.path)).toEqual(['knowledge/retrieval.md']);
  });

  it('refuses a document scope outside the read allowlist', async () => {
    const { app } = createAiApp();
    const { send } = await createPublicClient(app);

    const conversation = await startConversation(send, { type: 'document', ids: ['secrets/keys.md'] });
    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Read this' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PATH_NOT_ALLOWED');
  });

  it('keeps the transcript as working context, not durable memory', async () => {
    const { app, vault } = createAiApp();
    const { agent, send } = await createPublicClient(app);

    const conversation = await startConversation(send);
    await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Remember that I prefer short updates' });

    const stored = await agent.get(`/api/v1/conversations/${conversation.id}`);
    expect(stored.body.data.conversation.messages).toHaveLength(2);
    expect(vault.read('memory/MEMORY.md')).not.toContain('short updates');
  });

  it('surfaces an upstream provider failure safely', async () => {
    const { app, nvidia } = createAiApp();
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    nvidia.mode = 'upstream-error';
    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Anything' });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_UPSTREAM_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('internal provider detail');
  });

  it('reports a provider timeout distinctly', async () => {
    const { app, nvidia } = createAiApp();
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    nvidia.mode = 'timeout';
    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Anything' });

    expect(response.status).toBe(504);
    expect(response.body.error.code).toBe('AI_TIMEOUT');
  });

  it('validates the message payload', async () => {
    const { app } = createAiApp();
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`).send({ content: '' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports an unknown conversation as not found', async () => {
    const { app } = createAiApp();
    const { agent } = await createPublicClient(app);
    expect((await agent.get('/api/v1/conversations/cnv_missing')).status).toBe(404);
  });

  it('streams a reply as Server-Sent Events', async () => {
    const { app } = createAiApp({ reply: 'A streamed answer [S1].' });
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Stream this', stream: true });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');

    const events = response.text
      .split('\n\n')
      .filter((frame) => frame.startsWith('data:'))
      .map((frame) => JSON.parse(frame.slice(5).trim()));

    expect(events[0].type).toBe('manifest');
    expect(events.at(-1).type).toBe('done');
    expect(events.some((event) => event.type === 'message')).toBe(true);
  });
});

describe('conversational operation proposals', () => {
  const proposalReply = JSON.stringify({
    answer: 'I can add that task [S3].',
    operations: [
      {
        action: 'append',
        path: 'tasks/TASKS.md',
        content: '- [ ] Renew the domain @priority(medium)',
        underHeading: 'Open',
        reason: 'Requested in conversation'
      }
    ]
  });

  it('creates a reviewable proposal and writes nothing', async () => {
    const { app, vault } = createAiApp({ reply: proposalReply });
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Add a task to renew the domain', allowOperations: true });

    expect(response.status).toBe(200);
    expect(response.body.data.operations).toHaveLength(1);

    const [operation] = response.body.data.operations;
    expect(operation.status).toBe('proposed');
    expect(operation.source).toBe('conversation');
    expect(operation.diff).toContain('+- [ ] Renew the domain');
    expect(operation.sources.length).toBeGreaterThan(0);
    expect(vault.read('tasks/TASKS.md')).not.toContain('Renew the domain');
  });

  it('applies a conversational proposal only after approval and execution', async () => {
    const { app, vault } = createAiApp({ reply: proposalReply });
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    const message = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Add a task', allowOperations: true });
    const operationId = message.body.data.operations[0].id;

    await send('post', `/api/v1/operations/${operationId}/approve`).send({});
    const executed = await send('post', `/api/v1/operations/${operationId}/execute`).send({});

    expect(executed.body.data.operation.status).toBe('succeeded');
    expect(executed.body.data.operation.result.verified).toBe(true);
    expect(vault.read('tasks/TASKS.md')).toContain('- [ ] Renew the domain');
  });

  it('rejects a model-proposed path outside the write allowlist', async () => {
    const { app, vault } = createAiApp({
      reply: JSON.stringify({
        answer: 'Attempting a registry edit.',
        operations: [{ action: 'replace', path: 'NEXUS.md', content: 'overwritten' }]
      })
    });
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Rewrite the workspace rules', allowOperations: true });

    expect(response.body.data.operations).toHaveLength(0);
    expect(response.body.data.rejectedOperations).toHaveLength(1);
    expect(vault.read('NEXUS.md')).toContain('Deterministic retrieval');
  });

  it('rejects a model-proposed delete while destructive operations are disabled', async () => {
    const { app, vault } = createAiApp({
      reply: JSON.stringify({
        answer: 'Removing it.',
        operations: [{ action: 'delete', path: 'knowledge/retrieval.md' }]
      })
    });
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Delete the retrieval note', allowOperations: true });

    expect(response.body.data.operations).toHaveLength(0);
    expect(vault.has('knowledge/retrieval.md')).toBe(true);
  });

  it('refuses to request proposals while writes are disabled', async () => {
    const nvidia = createFakeNvidia();
    const { app } = createTestApp({
      environment: NVIDIA_ENVIRONMENT,
      aiFetchImpl: nvidia.fetchImpl
    });
    const { send } = await createPublicClient(app);
    const conversation = await startConversation(send);

    const response = await send('post', `/api/v1/conversations/${conversation.id}/messages`)
      .send({ content: 'Change something', allowOperations: true });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('VAULT_WRITE_DISABLED');
  });
});

describe('planning with a reasoning provider', () => {
  it('adds a labelled narrative on top of the deterministic plan', async () => {
    const { app } = createAiApp({ reply: 'Start with the overdue item [S1].' });
    const { send } = await createPublicClient(app);

    const response = await send('post', '/api/v1/planning/today/proposals').send({ goal: 'Plan today' });

    expect(response.status).toBe(200);
    expect(response.body.data.plan.recommendations[0].basis).toBe('deterministic');
    expect(response.body.data.narrative.basis).toBe('ai-recommendation');
    expect(response.body.data.aiAvailable).toBe(true);
  });

  it('returns the deterministic plan when the provider fails', async () => {
    const { app, nvidia } = createAiApp();
    const { send } = await createPublicClient(app);

    nvidia.mode = 'upstream-error';
    const response = await send('post', '/api/v1/planning/today/proposals').send({ goal: 'Plan today' });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('AI_UPSTREAM_ERROR');
  });
});

describe('memory proposals', () => {
  it('proposes a memory without writing it, flagging conflicts', async () => {
    const { app, vault } = createAiApp();
    const { agent, send } = await createPublicClient(app);

    const response = await send('post', '/api/v1/memory/proposals').send({
      statement: 'Kofi prefers concise summaries in every report',
      type: 'preference',
      sources: ['knowledge/retrieval.md']
    });

    expect(response.status).toBe(201);
    const { proposal } = response.body.data;
    expect(proposal.status).toBe('proposed');
    expect(proposal.targetPath).toBe('memory/MEMORY.md');
    expect(proposal.conflicts.length).toBeGreaterThan(0);
    expect(vault.read('memory/MEMORY.md')).not.toContain('in every report');

    const listed = await agent.get('/api/v1/memory');
    expect(listed.body.data.proposals.some((item) => item.id === proposal.id)).toBe(true);
  });

  it('writes the memory only after approval, through the operation pipeline', async () => {
    const { app, vault } = createAiApp();
    const { agent, send } = await createPublicClient(app);

    const proposed = await send('post', '/api/v1/memory/proposals').send({
      statement: 'Invoices are issued on the first working day of the month',
      type: 'fact'
    });

    const approved = await send('post', `/api/v1/memory/proposals/${proposed.body.data.proposal.id}/approve`).send({});

    expect(approved.status).toBe(200);
    expect(approved.body.data.operation.status).toBe('succeeded');
    expect(vault.read('memory/MEMORY.md')).toContain('Invoices are issued on the first working day');

    const listed = await agent.get('/api/v1/memory');
    expect(listed.body.data.records.some((record) => record.statement.includes('Invoices are issued'))).toBe(true);
  });

  it('rejects a proposal without writing anything', async () => {
    const { app, vault } = createAiApp();
    const { send } = await createPublicClient(app);

    const before = vault.read('memory/MEMORY.md');
    const proposed = await send('post', '/api/v1/memory/proposals').send({ statement: 'Something unwanted' });
    const rejected = await send('post', `/api/v1/memory/proposals/${proposed.body.data.proposal.id}/reject`)
      .send({ reason: 'Not accurate' });

    expect(rejected.body.data.proposal.status).toBe('rejected');
    expect(vault.read('memory/MEMORY.md')).toBe(before);
  });

  it('corrects a stored memory in place', async () => {
    const { app, vault } = createAiApp();
    const { send } = await createPublicClient(app);

    const response = await send('patch', '/api/v1/memory/mem-style')
      .send({ statement: 'Kofi prefers concise written summaries' });

    expect(response.status).toBe(200);
    expect(vault.read('memory/MEMORY.md')).toContain('concise written summaries');
    expect(vault.read('memory/MEMORY.md')).not.toContain('- Kofi prefers concise summaries @id');
  });

  it('forgets a memory record', async () => {
    const { app, vault } = createAiApp();
    const { send } = await createPublicClient(app);

    const response = await send('delete', '/api/v1/memory/mem-style').send({});

    expect(response.status).toBe(200);
    expect(vault.read('memory/MEMORY.md')).not.toContain('Kofi prefers concise summaries');
    expect(vault.read('memory/MEMORY.md')).toContain('## Records');
  });

  it('reports an unknown memory record as not found', async () => {
    const { app } = createAiApp();
    const { send } = await createPublicClient(app);
    expect((await send('delete', '/api/v1/memory/mem-missing').send({})).status).toBe(404);
  });
});
