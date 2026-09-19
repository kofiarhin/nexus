import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, Dialog, Field, SourceList } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import {
  runMutation,
  useApproveMemory,
  useDeleteMemory,
  useMemory,
  useProposeMemory,
  useRejectMemory,
  useUpdateMemory
} from '../lib/queries.js';

const TYPES = ['fact', 'preference', 'decision', 'goal', 'lesson', 'profile'];

export default function Memory() {
  const memory = useMemory();
  const propose = useProposeMemory();
  const approve = useApproveMemory();
  const reject = useRejectMemory();
  const update = useUpdateMemory();
  const remove = useDeleteMemory();

  const [statement, setStatement] = useState('');
  const [type, setType] = useState('fact');
  const [editing, setEditing] = useState(null);
  const [editStatement, setEditStatement] = useState('');

  const mutationError = propose.error ?? approve.error ?? reject.error ?? update.error ?? remove.error;

  const submitProposal = async (event) => {
    event.preventDefault();
    if (!statement.trim()) return;
    if (!await runMutation(propose, { statement, type, sources: [] })) return;
    setStatement('');
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    if (!await runMutation(update, { memoryId: editing.id, statement: editStatement })) return;
    setEditing(null);
  };

  return (
    <>
      <PageHeader
        title="Memory"
        description="Durable memory lives in reviewed Vault records. Nothing inferred is stored without approval."
      />

      <Card title="Propose a memory" description="Proposals are reviewable and are not written until approved.">
        <form onSubmit={submitProposal}>
          <Field label="Statement" required>
            <textarea
              rows={2}
              value={statement}
              placeholder="A durable fact, preference, decision, goal, or lesson."
              onChange={(event) => setStatement(event.target.value)}
            />
          </Field>
          <Field label="Classification">
            <select value={type} onChange={(event) => setType(event.target.value)}>
              {TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="button button-primary" disabled={propose.isPending}>
            Propose memory
          </button>
        </form>
        {mutationError && <ErrorState error={mutationError} compact />}
      </Card>

      {memory.isPending && <Loading label="Loading memory…" />}
      {memory.isError && <ErrorState error={memory.error} onRetry={memory.refetch} />}

      {memory.isSuccess && (
        <>
          <Card title="Pending proposals">
            {memory.data.proposals.filter((proposal) => proposal.status === 'proposed').length === 0 ? (
              <p className="muted">No memory proposals are awaiting review.</p>
            ) : (
              <ul className="plain-list">
                {memory.data.proposals
                  .filter((proposal) => proposal.status === 'proposed')
                  .map((proposal) => (
                    <li key={proposal.id} className="memory-proposal">
                      <p>
                        <strong>{proposal.statement}</strong>
                      </p>
                      <p className="muted">
                        <Badge tone="neutral">{proposal.type}</Badge>{' '}
                        <Badge tone="neutral">confidence: {proposal.confidence}</Badge> · target{' '}
                        <code>{proposal.targetPath}</code>
                      </p>

                      {proposal.conflicts.length > 0 && (
                        <div className="notice notice-warning">
                          <strong>Possible conflict with existing memory:</strong>
                          <ul>
                            {proposal.conflicts.map((conflict) => (
                              <li key={conflict.id}>
                                {conflict.statement} <span className="muted">({conflict.overlap} overlap)</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {proposal.sources.length > 0 && (
                        <SourceList sources={proposal.sources.map((path) => ({ path }))} title="Supporting sources" />
                      )}

                      <div className="operation-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          disabled={approve.isPending}
                          onClick={() => approve.mutate({ proposalId: proposal.id })}
                        >
                          Approve and record
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={reject.isPending}
                          onClick={() => reject.mutate({ proposalId: proposal.id, reason: 'Rejected by owner' })}
                        >
                          Reject
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card title="Approved memory" description={`Stored in ${memory.data.path}`}>
            {memory.data.records.length === 0 ? (
              <Empty
                title="No durable memory recorded"
                description="Approve a proposal to write the first memory record."
              />
            ) : (
              <ul className="plain-list">
                {memory.data.records.map((record) => (
                  <li key={record.id} className="memory-record">
                    <div>
                      <p>{record.statement}</p>
                      <p className="muted">
                        <Badge tone="neutral">{record.type}</Badge>
                        {record.updatedAt && <> · updated {record.updatedAt}</>}
                        {record.sources.length > 0 && <> · sources: {record.sources.join(', ')}</>}
                      </p>
                    </div>
                    <div className="task-meta">
                      <button
                        type="button"
                        className="button button-ghost"
                        onClick={() => {
                          setEditing(record);
                          setEditStatement(record.statement);
                        }}
                      >
                        Correct
                      </button>
                      <button
                        type="button"
                        className="button button-ghost"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ memoryId: record.id })}
                      >
                        Forget
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <SourceList sources={memory.data.sources} />
        </>
      )}

      <Dialog
        open={Boolean(editing)}
        title="Correct memory"
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" className="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" form="edit-memory" className="button button-primary" disabled={update.isPending}>
              Save correction
            </button>
          </>
        }
      >
        <form id="edit-memory" onSubmit={submitEdit}>
          <Field label="Statement" required>
            <textarea rows={3} value={editStatement} onChange={(event) => setEditStatement(event.target.value)} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}
