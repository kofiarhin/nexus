import { redact } from './redact.js';

/**
 * Structured, redacted event logging (specification section 23).
 * Logs never carry credentials or full document bodies.
 */
export function createLogger({ enabled = true, sink = console } = {}) {
  const emit = (level, event, fields) => {
    if (!enabled) return;
    const line = JSON.stringify({
      level,
      event,
      timestamp: new Date().toISOString(),
      ...redact(fields ?? {})
    });
    if (level === 'error') sink.error(line);
    else sink.log(line);
  };

  return {
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields)
  };
}

export const silentLogger = createLogger({ enabled: false });
