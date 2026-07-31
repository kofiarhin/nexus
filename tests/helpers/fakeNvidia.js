/**
 * Deterministic stand-in for the NVIDIA chat-completions endpoint.
 * No real credentials or network access are involved in any test.
 */
export function createFakeNvidia({ reply = 'Deterministic answer [S1].', usage = null } = {}) {
  const state = { requests: [], mode: 'ok' };

  const fetchImpl = async (url, options = {}) => {
    state.requests.push({ url, body: JSON.parse(options.body ?? '{}') });

    if (state.mode === 'timeout') {
      // Never settles; the client's AbortController resolves the outcome.
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }

    if (state.mode === 'upstream-error') {
      return new Response(JSON.stringify({ error: 'internal provider detail' }), { status: 500 });
    }

    if (state.mode === 'malformed') {
      return new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } });
    }

    const content = typeof state.reply === 'function' ? state.reply(JSON.parse(options.body ?? '{}')) : state.reply;

    return new Response(
      JSON.stringify({
        model: 'test/model',
        choices: [{ message: { role: 'assistant', content } }],
        usage
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  state.reply = reply;

  return { fetchImpl, state };
}

export const NVIDIA_ENVIRONMENT = {
  AI_PROVIDER: 'nvidia',
  NVIDIA_API_KEY: 'test-nvidia-key',
  NVIDIA_MODEL: 'test/model',
  NVIDIA_TIMEOUT_MS: '80'
};
