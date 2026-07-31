import { appError } from '../../utils/errors.js';

/**
 * Low-level NVIDIA chat-completions client (OpenAI-compatible endpoint).
 *
 * The client never sees Vault credentials: the caller passes
 * an already-bounded set of messages. All upstream failures normalize to
 * AI_UPSTREAM_ERROR or AI_TIMEOUT so no provider payload reaches a response.
 */
export class NvidiaClient {
  constructor({
    apiKey,
    model,
    baseUrl = 'https://integrate.api.nvidia.com/v1',
    timeoutMs = 45000,
    maxOutputTokens = 1200,
    fetchImpl = fetch
  } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.maxOutputTokens = maxOutputTokens;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.model);
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw appError('AI_NOT_CONFIGURED', 'The NVIDIA reasoning provider is not configured');
    }
  }

  async #send(messages, { temperature = 0.2, stream = false, signal } = {}) {
    this.assertConfigured();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: stream ? 'text/event-stream' : 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature,
          max_tokens: this.maxOutputTokens,
          stream
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw appError('AI_UPSTREAM_ERROR', 'The reasoning provider rejected the request');
      }

      return response;
    } catch (error) {
      if (error?.code === 'AI_UPSTREAM_ERROR' || error?.code === 'AI_NOT_CONFIGURED') throw error;
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        throw appError('AI_TIMEOUT', 'The reasoning provider did not respond in time');
      }
      throw appError('AI_UPSTREAM_ERROR', 'The reasoning provider is unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(messages, options = {}) {
    const response = await this.#send(messages, { ...options, stream: false });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw appError('AI_UPSTREAM_ERROR', 'The reasoning provider returned an invalid response');
    }

    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw appError('AI_UPSTREAM_ERROR', 'The reasoning provider returned an empty response');
    }

    return {
      text,
      model: payload?.model ?? this.model,
      usage: payload?.usage
        ? {
          promptTokens: payload.usage.prompt_tokens ?? null,
          completionTokens: payload.usage.completion_tokens ?? null
        }
        : null
    };
  }

  /** Yields incremental text deltas from the provider's SSE stream. */
  async *stream(messages, options = {}) {
    const response = await this.#send(messages, { ...options, stream: true });

    if (!response.body || typeof response.body.getReader !== 'function') {
      const payload = await this.complete(messages, options);
      yield payload.text;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '' || data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data);
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta !== '') yield delta;
        } catch {
          // A partial or non-JSON keepalive frame is skipped rather than failing
          // the whole stream.
        }
      }
    }
  }
}
