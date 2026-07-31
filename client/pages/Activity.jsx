import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, statusTone } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { OperationReview } from '../components/OperationReview.jsx';
import { useActivity, useOperations } from '../lib/queries.js';

export default function Activity() {
  const activity = useActivity();
  const operations = useOperations();
  const [filter, setFilter] = useState('all');

  const events = (activity.data?.events ?? []).filter(
    (event) => filter === 'all' || event.result === filter
  );

  const pending = (operations.data?.operations ?? []).filter(
    (operation) => operation.status === 'proposed' || operation.status === 'approved'
  );

  return (
    <>
      <PageHeader
        title="Activity"
        description="Proposals, approvals, executions, conflicts, failures, and rollbacks with Git evidence."
      />

      <Card title="Awaiting decision">
        {operations.isPending && <Loading label="Loading operations…" />}
        {operations.isError && <ErrorState error={operations.error} compact />}
        {operations.isSuccess && pending.length === 0 && (
          <p className="muted">No operations are awaiting approval or execution.</p>
        )}
        {pending.map((operation) => (
          <OperationReview key={operation.id} operation={operation} onChanged={() => { operations.refetch(); activity.refetch(); }} />
        ))}
      </Card>

      <Card
        title="Audit history"
        description="Session-scoped operational traceability. Git remains the durable revision record."
        actions={
          <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by result">
            <option value="all">All results</option>
            <option value="proposed">Proposed</option>
            <option value="approved">Approved</option>
            <option value="succeeded">Succeeded</option>
            <option value="rejected">Rejected</option>
            <option value="conflicted">Conflicted</option>
            <option value="failed">Failed</option>
          </select>
        }
      >
        {activity.isPending && <Loading label="Loading activity…" />}
        {activity.isError && <ErrorState error={activity.error} onRetry={activity.refetch} />}
        {activity.isSuccess && events.length === 0 && (
          <Empty
            title="No activity recorded"
            description="Audit events are recorded per process and reset when the API restarts."
          />
        )}

        {events.length > 0 && (
          <div className="table-scroll">
            <table className="activity-table">
              <thead>
                <tr>
                  <th scope="col">Result</th>
                  <th scope="col">Action</th>
                  <th scope="col">Path</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Revisions</th>
                  <th scope="col">Commit</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      <Badge tone={statusTone(event.result)}>{event.result}</Badge>
                    </td>
                    <td>{event.action}</td>
                    <td>
                      <code>{event.path ?? '—'}</code>
                      {event.destinationPath && (
                        <>
                          {' → '}
                          <code>{event.destinationPath}</code>
                        </>
                      )}
                    </td>
                    <td>{event.risk ?? '—'}</td>
                    <td>
                      {event.beforeRevision ? <code>{event.beforeRevision.slice(0, 7)}</code> : '—'}
                      {' → '}
                      {event.afterRevision ? <code>{event.afterRevision.slice(0, 7)}</code> : '—'}
                    </td>
                    <td>{event.commit ? <code>{event.commit.slice(0, 10)}</code> : '—'}</td>
                    <td>{event.actor?.email ?? '—'}</td>
                    <td className="muted">{event.timestamp}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
