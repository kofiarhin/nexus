export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api/v1';

/**
 * Error carrying the server's normalized code so the UI can distinguish
 * permission, conflict, validation, and upstream states instead of showing one
 * generic failure.
 */
export class ApiError extends Error {
  constructor({ code, message, details, status, requestId }) {
    super(message ?? 'The request failed');
    this.name = 'ApiError';
    this.code = code ?? 'INTERNAL_ERROR';
    this.details = details ?? null;
    this.status = status ?? 0;
    this.requestId = requestId ?? null;
  }

  get isConflict() {
    return this.code === 'VAULT_CONFLICT' || this.code === 'CONFLICT' || this.code === 'IDEMPOTENCY_CONFLICT';
  }

  get isPermission() {
    return ['FORBIDDEN', 'PATH_NOT_ALLOWED', 'OPERATION_NOT_ALLOWED', 'VAULT_WRITE_DISABLED'].includes(this.code);
  }

  get isValidation() {
    return this.code === 'VALIDATION_ERROR' || this.code === 'INVALID_JSON';
  }
}

/**
 * Single API entry point. Converts every failure into an ApiError.
 */
export async function apiRequest(path, { method = 'GET', body, idempotencyKey, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    throw new ApiError({ code: 'NETWORK_ERROR', message: 'The Nexus API could not be reached.' });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success !== true) {
    throw new ApiError({
      code: payload?.error?.code,
      message: payload?.error?.message,
      details: payload?.error?.details,
      status: response.status,
      requestId: payload?.requestId ?? response.headers.get('x-request-id')
    });
  }

  return payload.data;
}

/** Opens a Server-Sent Events stream for a streamed conversation reply. */
export async function apiStream(path, { body, onEvent, signal }) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok || !response.body) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new ApiError({
      code: payload?.error?.code,
      message: payload?.error?.message,
      status: response.status
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        // Ignore frames that are not complete JSON.
      }
    }
  }
}
