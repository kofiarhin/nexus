import { describe, expect, it } from 'vitest';
import { createReasoningProvider } from '../../server/integrations/nvidia/nvidiaProvider.js';
import { buildAnswerMessages, extractJsonObject, renderSources } from '../../server/integrations/nvidia/prompts.js';
import { mapCitations } from '../../server/utils/citations.js';
import { loadEnv } from '../../server/config/env.js';
import { createFakeNvidia, NVIDIA_ENVIRONMENT } from '../helpers/fakeNvidia.js';

const SOURCES = [
  { path: 'projects/nexus/PROJECT.md', sha: 'sha-1', title: 'Nexus', reason: 'Current project state', excerpt: 'Foundation implemented.' },
  { path: 'tasks/TASKS.md', sha: 'sha-2', title: 'Tasks', reason: 'Task records', excerpt: '- [ ] Review the plan' }
];

const providerFor = (fetchImpl, overrides = {}) => createReasoningProvider({
  env: loadEnv({ PORT: '5000', ...NVIDIA_ENVIRONMENT, ...overrides }),
  fetchImpl
});

describe('provider configuration', () => {
  it('reports unavailable when no API key is set', async () => {
    const provider = providerFor(async () => {
      throw new Error('should not be called');
    }, { NVIDIA_API_KEY: '' });

    expect(provider.isConfigured()).toBe(false);
    await expect(provider.generateAnswer([], [])).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  it('reports unavailable for an unsupported provider', () => {
    expect(providerFor(async () => {}, { AI_PROVIDER: 'other' }).isConfigured()).toBe(false);
  });
});

describe('generateAnswer', () => {
  it('returns the answer with citations mapped to the manifest', async () => {
    const { fetchImpl } = createFakeNvidia({ reply: 'The project is active [S1]. A task is open [S2].' });
    const result = await providerFor(fetchImpl).generateAnswer(
      [{ role: 'user', content: 'What is happening?' }],
      SOURCES
    );

    expect(result.text).toContain('The project is active');
    expect(result.citations).toEqual([
      { marker: 'S1', path: 'projects/nexus/PROJECT.md', sha: 'sha-1', title: 'Nexus', reason: 'Current project state' },
      { marker: 'S2', path: 'tasks/TASKS.md', sha: 'sha-2', title: 'Tasks', reason: 'Task records' }
    ]);
  });

  it('sends only the supplied sources, never credentials', async () => {
    const { fetchImpl, state } = createFakeNvidia();
    await providerFor(fetchImpl).generateAnswer([{ role: 'user', content: 'Hello' }], SOURCES);

    const prompt = JSON.stringify(state.requests[0].body);
    expect(prompt).toContain('projects/nexus/PROJECT.md');
    expect(prompt).not.toContain('test-nvidia-key');
    expect(prompt).not.toContain('GITHUB_TOKEN');
  });

  it('normalizes an upstream failure without leaking the provider payload', async () => {
    const { fetchImpl, state } = createFakeNvidia();
    state.mode = 'upstream-error';

    const error = await providerFor(fetchImpl)
      .generateAnswer([{ role: 'user', content: 'Hi' }], SOURCES)
      .catch((thrown) => thrown);

    expect(error.code).toBe('AI_UPSTREAM_ERROR');
    expect(error.message).not.toContain('internal provider detail');
  });

  it('reports a timeout distinctly from an upstream failure', async () => {
    const { fetchImpl, state } = createFakeNvidia();
    state.mode = 'timeout';

    await expect(providerFor(fetchImpl).generateAnswer([{ role: 'user', content: 'Hi' }], SOURCES))
      .rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });

  it('rejects a malformed provider response', async () => {
    const { fetchImpl, state } = createFakeNvidia();
    state.mode = 'malformed';

    await expect(providerFor(fetchImpl).generateAnswer([{ role: 'user', content: 'Hi' }], SOURCES))
      .rejects.toMatchObject({ code: 'AI_UPSTREAM_ERROR' });
  });
});

describe('proposeOperations', () => {
  const propose = (reply, allowed = ['append', 'replace']) => {
    const { fetchImpl } = createFakeNvidia({ reply });
    return providerFor(fetchImpl).proposeOperations('Add a task', SOURCES, allowed, {
      writablePaths: ['tasks']
    });
  };

  it('accepts a well-formed structured proposal', async () => {
    const result = await propose(JSON.stringify({
      answer: 'I will add the task [S2].',
      operations: [{ action: 'append', path: 'tasks/TASKS.md', content: '- [ ] New task', reason: 'Requested' }]
    }));

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ action: 'append', path: 'tasks/TASKS.md' });
    expect(result.citations[0].path).toBe('tasks/TASKS.md');
  });

  it('extracts JSON from a fenced code block', async () => {
    const result = await propose('```json\n{"answer":"ok","operations":[]}\n```');
    expect(result.answer).toBe('ok');
    expect(result.operations).toEqual([]);
  });

  it('drops an operation whose action is not allowed', async () => {
    const result = await propose(
      JSON.stringify({ answer: 'ok', operations: [{ action: 'delete', path: 'tasks/TASKS.md' }] }),
      ['append']
    );

    expect(result.operations).toEqual([]);
    expect(result.rejected[0].candidate).toMatchObject({ action: 'delete' });
  });

  it('drops an operation with a traversal path', async () => {
    const result = await propose(JSON.stringify({
      answer: 'ok',
      operations: [{ action: 'replace', path: '../../etc/passwd', content: 'x' }]
    }));

    expect(result.operations).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('drops a malformed operation but keeps the valid one', async () => {
    const result = await propose(JSON.stringify({
      answer: 'ok',
      operations: [
        { action: 'append', path: 'tasks/TASKS.md', content: '- [ ] Keep' },
        { path: 'tasks/TASKS.md' }
      ]
    }));

    expect(result.operations).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it('returns no operations when the response is not parsable JSON', async () => {
    const result = await propose('I am not going to answer in JSON.');
    expect(result.operations).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/parsable/i);
  });

  it('caps how many operations one turn can propose', async () => {
    const result = await propose(JSON.stringify({
      answer: 'ok',
      operations: Array.from({ length: 25 }, () => ({
        action: 'append',
        path: 'tasks/TASKS.md',
        content: '- [ ] Bulk'
      }))
    }));

    expect(result.operations.length).toBeLessThanOrEqual(10);
  });
});

describe('prompt construction', () => {
  it('numbers sources so citations can be mapped back', () => {
    const rendered = renderSources(SOURCES);
    expect(rendered).toContain('[S1] path: projects/nexus/PROJECT.md');
    expect(rendered).toContain('[S2] path: tasks/TASKS.md');
  });

  it('states that the model may only propose', () => {
    const [system] = buildAnswerMessages({ messages: [], sources: SOURCES });
    expect(system.content).toMatch(/only propose/i);
    expect(system.content).toMatch(/answer only from the numbered vault sources/i);
  });

  it('includes workspace rules when supplied', () => {
    const [system] = buildAnswerMessages({ messages: [], sources: [], workspaceRules: 'Never guess.' });
    expect(system.content).toContain('Never guess.');
  });
});

describe('citation mapping', () => {
  it('ignores markers outside the manifest range', () => {
    expect(mapCitations('Claim [S9]', SOURCES)).toEqual([]);
  });

  it('deduplicates repeated markers and preserves order', () => {
    expect(mapCitations('[S2] and [S1] and [S2]', SOURCES).map((citation) => citation.marker))
      .toEqual(['S1', 'S2']);
  });
});

describe('extractJsonObject', () => {
  it('finds a balanced object embedded in prose', () => {
    expect(extractJsonObject('Sure. {"a": {"b": 1}} Done.')).toEqual({ a: { b: 1 } });
  });

  it('handles braces inside strings', () => {
    expect(extractJsonObject('{"text": "a } brace"}')).toEqual({ text: 'a } brace' });
  });

  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{ broken')).toBeNull();
  });
});
