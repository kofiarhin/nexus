import React from 'react';

/**
 * Explicit view states.
 *
 * Loading, empty, permission, conflict, validation, and upstream failures are
 * rendered distinctly so the interface never gives misleading recovery advice.
 */

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title = 'Nothing here yet', description, action }) {
  return (
    <div className="state state-empty">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

const ERROR_PRESENTATION = {
  FORBIDDEN: { title: 'Not permitted', hint: 'This action is restricted by the current policy.' },
  PATH_NOT_ALLOWED: { title: 'Path not allowed', hint: 'This Vault path is outside the configured allowlist.' },
  OPERATION_NOT_ALLOWED: { title: 'Operation not allowed', hint: 'This operation is disabled by the current policy.' },
  APPROVAL_REQUIRED: { title: 'Approval required', hint: 'Approve this operation before executing it.' },
  DESTRUCTIVE_CONFIRMATION_REQUIRED: {
    title: 'Confirmation required',
    hint: 'This permanently removes Vault content and must be confirmed explicitly.'
  },
  VAULT_CONFLICT: {
    title: 'The document changed',
    hint: 'Someone or something updated this file since it was read. Reload, compare, and repropose.'
  },
  IDEMPOTENCY_CONFLICT: { title: 'Duplicate request', hint: 'This idempotency key was already used for another request.' },
  VALIDATION_ERROR: { title: 'Check the form', hint: 'One or more fields are invalid.' },
  VAULT_NOT_CONFIGURED: {
    title: 'Vault not configured',
    hint: 'Set GITHUB_TOKEN and GITHUB_OWNER on the server to connect the Vault.'
  },
  VAULT_WRITE_DISABLED: {
    title: 'Writes are disabled',
    hint: 'Enable WRITE_OPERATIONS_ENABLED to allow changes.'
  },
  VAULT_FILE_NOT_FOUND: { title: 'Not found in the Vault', hint: 'The requested document does not exist.' },
  VAULT_FILE_EXISTS: { title: 'Already exists', hint: 'A file already exists at that path. Use replace instead.' },
  VAULT_UPSTREAM_ERROR: { title: 'The Vault is unavailable', hint: 'GitHub did not respond as expected. Try again shortly.' },
  AI_NOT_CONFIGURED: {
    title: 'Nexus reasoning is not configured',
    hint: 'Set NVIDIA_API_KEY on the server. Reading and administration still work without it.'
  },
  AI_UPSTREAM_ERROR: { title: 'The assistant is unavailable', hint: 'The reasoning provider did not respond. Try again.' },
  AI_TIMEOUT: { title: 'The assistant timed out', hint: 'The reasoning provider took too long. Try a narrower scope.' },
  RATE_LIMITED: { title: 'Too many requests', hint: 'Slow down for a moment and try again.' },
  NETWORK_ERROR: { title: 'Cannot reach the API', hint: 'Check that the Nexus API is running.' },
  NOT_FOUND: { title: 'Not found', hint: 'The requested record does not exist.' }
};

export function ErrorState({ error, onRetry, compact = false }) {
  if (!error) return null;

  const code = error.code ?? 'INTERNAL_ERROR';
  const presentation = ERROR_PRESENTATION[code] ?? {
    title: 'Something went wrong',
    hint: 'The request could not be completed.'
  };
  const fields = error.details?.fields ?? [];

  return (
    <div className={compact ? 'state state-error is-compact' : 'state state-error'} role="alert">
      <h3>{presentation.title}</h3>
      <p>{error.message || presentation.hint}</p>
      {presentation.hint && error.message !== presentation.hint && <p className="muted">{presentation.hint}</p>}

      {fields.length > 0 && (
        <ul className="field-errors">
          {fields.map((field) => (
            <li key={`${field.field}-${field.message}`}>
              <code>{field.field}</code> {field.message}
            </li>
          ))}
        </ul>
      )}

      {error.details?.currentRevision && (
        <dl className="conflict-details">
          <dt>Expected revision</dt>
          <dd><code>{String(error.details.expectedRevision).slice(0, 12)}</code></dd>
          <dt>Current revision</dt>
          <dd><code>{String(error.details.currentRevision).slice(0, 12)}</code></dd>
        </dl>
      )}

      <p className="muted error-code">
        <code>{code}</code>
        {error.requestId ? ` · request ${error.requestId}` : ''}
      </p>

      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Wraps a query result so each page handles its states the same way. */
export function QueryBoundary({ query, children, loadingLabel, empty, isEmpty }) {
  if (query.isPending) return <Loading label={loadingLabel} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  if (isEmpty?.(query.data)) return empty ?? <Empty />;
  return children(query.data);
}
