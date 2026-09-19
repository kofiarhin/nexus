import React, { useState } from 'react';
import { Badge, DiffView, Dialog, SourceList, riskTone, statusTone } from './Primitives.jsx';
import { ErrorState } from './States.jsx';
import { runMutation, useApproveOperation, useExecuteOperation, useRejectOperation } from '../lib/queries.js';

/**
 * Reviewing a proposed operation.
 *
 * The diff, risk, and target revision are shown before anything is applied.
 * Approval and execution stay separate actions; a destructive operation needs
 * an explicit typed confirmation.
 */
export function OperationReview({ operation, onChanged }) {
  const approve = useApproveOperation();
  const reject = useRejectOperation();
  const execute = useExecuteOperation();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const pending = approve.isPending || reject.isPending || execute.isPending;
  const error = approve.error ?? reject.error ?? execute.error;

  // A failed approval, rejection, or execution leaves its error on the mutation
  // state, which renders below; the caller is only notified on success.
  const settle = (result) => {
    if (result) onChanged?.(result);
  };

  const runExecute = async (confirmDestructive) => {
    const result = await runMutation(execute, {
      operationId: operation.id,
      confirmDestructive,
      // Retrying the same operation must never produce a second write.
      idempotencyKey: `op-${operation.id}`
    });
    if (result) {
      setConfirmOpen(false);
      setConfirmText('');
    }
    settle(result);
  };

  const canApprove = operation.status === 'proposed';
  const canExecute = operation.status === 'approved'
    || (operation.status === 'proposed' && !operation.requiresApproval);
  const isFinished = ['succeeded', 'rejected', 'rolled-back'].includes(operation.status);

  return (
    <article className="operation" aria-label={`Operation ${operation.action} ${operation.path}`}>
      <header className="operation-header">
        <div>
          <h3>
            <span className="operation-action">{operation.action}</span> <code>{operation.path}</code>
          </h3>
          <p className="muted">{operation.reason}</p>
        </div>
        <div className="operation-badges">
          <Badge tone={riskTone(operation.risk)}>{operation.risk}</Badge>
          <Badge tone={statusTone(operation.status)}>{operation.status}</Badge>
        </div>
      </header>

      {operation.destinationPath && (
        <p className="muted">
          Destination: <code>{operation.destinationPath}</code>
        </p>
      )}

      {operation.note && <p className="notice">{operation.note}</p>}

      {operation.stats && (
        <p className="muted">
          +{operation.stats.added} / −{operation.stats.removed} lines · expected revision{' '}
          <code>{operation.expectedSha ? operation.expectedSha.slice(0, 7) : 'new file'}</code>
        </p>
      )}

      <DiffView diff={operation.diff} emptyLabel="This operation relocates a file without changing its content." />

      <SourceList sources={operation.sources} title="Grounded in" />

      {operation.result?.commit && (
        <p className="success-note">
          Applied as commit <code>{String(operation.result.commit).slice(0, 10)}</code>
          {operation.result.verified ? ' and verified by readback.' : ' (readback verification did not match).'}
        </p>
      )}

      {error && <ErrorState error={error} compact />}

      {!isFinished && (
        <div className="operation-actions">
          {canApprove && (
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={async () => settle(await runMutation(approve, { operationId: operation.id }))}
            >
              Approve
            </button>
          )}
          {canExecute && (
            <button
              type="button"
              className="button button-primary"
              disabled={pending}
              onClick={() => (operation.requiresDestructiveConfirmation ? setConfirmOpen(true) : runExecute(false))}
            >
              {operation.requiresDestructiveConfirmation ? 'Delete permanently…' : 'Execute'}
            </button>
          )}
          <button
            type="button"
            className="button"
            disabled={pending}
            onClick={async () => settle(
              await runMutation(reject, { operationId: operation.id, reason: 'Rejected by owner' })
            )}
          >
            Reject
          </button>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        title="Confirm permanent deletion"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button type="button" className="button" onClick={() => setConfirmOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger"
              disabled={confirmText !== operation.path || pending}
              onClick={() => runExecute(true)}
            >
              Delete permanently
            </button>
          </>
        }
      >
        <p>
          This permanently removes <code>{operation.path}</code> from the Vault. Git history retains the previous
          content, but the file will no longer exist on the branch. Archiving is the reversible alternative.
        </p>
        <label htmlFor="confirm-path">
          Type the full path to confirm: <code>{operation.path}</code>
        </label>
        <input
          id="confirm-path"
          type="text"
          value={confirmText}
          autoComplete="off"
          onChange={(event) => setConfirmText(event.target.value)}
        />
      </Dialog>
    </article>
  );
}
