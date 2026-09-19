import React, { useEffect, useId, useRef } from 'react';

export function Card({ title, description, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="muted">{description}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children, required }) {
  const id = useId();
  const child = React.cloneElement(children, {
    id,
    'aria-describedby': hint || error ? `${id}-hint` : undefined,
    'aria-invalid': error ? 'true' : undefined,
    required
  });

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {child}
      {(hint || error) && (
        <p id={`${id}-hint`} className={error ? 'field-error' : 'field-hint'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export const riskTone = (risk) => (risk === 'destructive' ? 'danger' : risk === 'material' ? 'warning' : 'success');

export const statusTone = (status) => {
  if (['succeeded', 'done', 'approved'].includes(status)) return 'success';
  if (['failed', 'conflicted', 'rejected', 'blocked'].includes(status)) return 'danger';
  if (['executing', 'in-progress', 'proposed'].includes(status)) return 'warning';
  return 'neutral';
};

/**
 * Modal dialog with focus management: focus moves in on open, is trapped while
 * open, and returns to the trigger on close.
 */
export function Dialog({ open, title, onClose, children, footer }) {
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);
  const titleId = useId();

  // Held in a ref so an inline `onClose` prop cannot re-run the focus effect on
  // every render, which would pull focus out of the field being typed into.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    previousFocus.current = document.activeElement;
    const node = dialogRef.current;
    const focusableNodes = () => [
      ...(node?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
    ].filter((candidate) => !candidate.disabled);

    focusableNodes()[0]?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      // Recomputed per keystroke so controls that become enabled are included.
      const focusable = focusableNodes();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node?.addEventListener('keydown', onKeyDown);
    return () => {
      node?.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="button button-ghost" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}

/** Renders a unified diff with per-line semantics announced to assistive tech. */
export function DiffView({ diff, emptyLabel = 'No content change' }) {
  if (!diff) return <p className="muted">{emptyLabel}</p>;

  const lines = diff.split('\n');

  return (
    <pre className="diff" aria-label="Proposed change">
      {lines.map((line, index) => {
        const type = line.startsWith('+++') || line.startsWith('---')
          ? 'meta'
          : line.startsWith('@@')
            ? 'hunk'
            : line.startsWith('+')
              ? 'add'
              : line.startsWith('-')
                ? 'remove'
                : 'context';
        return (
          <span key={`diff-${index}`} className={`diff-line diff-${type}`}>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
}

/** Displays the retrieval manifest behind an answer or recommendation. */
export function SourceList({ sources, title = 'Sources' }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="sources">
      <h4>{title}</h4>
      <ul>
        {sources.map((source, index) => (
          <li key={`${source.path}-${index}`}>
            <code>{source.path}</code>
            {source.revision || source.sha ? (
              <span className="muted"> @{String(source.revision ?? source.sha).slice(0, 7)}</span>
            ) : null}
            {source.reason && <span className="source-reason"> — {source.reason}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
