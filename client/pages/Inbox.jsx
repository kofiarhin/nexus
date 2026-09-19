import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, Field, SourceList } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { apiRequest } from '../lib/api.js';
import { runMutation, useCaptureInbox, useDeleteInboxEntry, useInbox, usePromoteInboxEntry } from '../lib/queries.js';

const KINDS = ['unclassified', 'note', 'idea', 'task', 'request'];

export default function Inbox() {
  const inbox = useInbox();
  const capture = useCaptureInbox();
  const promote = usePromoteInboxEntry();
  const discard = useDeleteInboxEntry();

  const [content, setContent] = useState('');
  const [kind, setKind] = useState('unclassified');
  const [suggestions, setSuggestions] = useState({});
  const [suggestionError, setSuggestionError] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    if (!await runMutation(capture, { content, kind })) return;
    setContent('');
    setKind('unclassified');
  };

  const suggest = async (entryId) => {
    setSuggestionError(null);
    try {
      const result = await apiRequest(`/inbox/${encodeURIComponent(entryId)}/suggestion`);
      setSuggestions((current) => ({ ...current, [entryId]: result }));
    } catch (error) {
      setSuggestionError(error);
    }
  };

  const mutationError = capture.error ?? promote.error ?? discard.error;

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Quick capture. Nothing is classified or promoted without an explicit action."
      />

      <Card title="Capture">
        <form onSubmit={submit}>
          <Field label="Content" required>
            <textarea
              rows={3}
              value={content}
              placeholder="A note, idea, task, or request…"
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <Field label="Kind">
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              {KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="button button-primary" disabled={capture.isPending}>
            Capture
          </button>
        </form>
        {mutationError && <ErrorState error={mutationError} compact />}
      </Card>

      <Card title="Captured items">
        {inbox.isPending && <Loading label="Loading inbox…" />}
        {inbox.isError && <ErrorState error={inbox.error} onRetry={inbox.refetch} />}
        {inbox.isSuccess && inbox.data.entries.length === 0 && (
          <Empty title="Inbox is empty" description="Captured items appear here until you review them." />
        )}

        <ul className="plain-list">
          {(inbox.data?.entries ?? []).map((entry) => (
            <li key={entry.id} className="inbox-entry">
              <div>
                <p>{entry.content}</p>
                <p className="muted">
                  <Badge tone="neutral">{entry.kind}</Badge>{' '}
                  <Badge tone={entry.status === 'promoted' ? 'success' : 'warning'}>{entry.status}</Badge>
                  {entry.capturedAt && <> · captured {entry.capturedAt}</>}
                </p>
                {suggestions[entry.id] && (
                  <div className="notice">
                    {suggestions[entry.id].aiAvailable ? (
                      <>
                        <strong>Suggestion (recommendation only):</strong>
                        <p>{suggestions[entry.id].suggestion.text}</p>
                      </>
                    ) : (
                      <p>{suggestions[entry.id].reason}</p>
                    )}
                  </div>
                )}
              </div>
              <div className="task-meta">
                <button type="button" className="button button-ghost" onClick={() => suggest(entry.id)}>
                  Suggest destination
                </button>
                {entry.status !== 'promoted' && (
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={promote.isPending}
                    onClick={() => promote.mutate({ entryId: entry.id, destination: null })}
                  >
                    Mark promoted
                  </button>
                )}
                <button
                  type="button"
                  className="button button-ghost"
                  disabled={discard.isPending}
                  onClick={() => discard.mutate({ entryId: entry.id })}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>

        {suggestionError && <ErrorState error={suggestionError} compact />}
      </Card>

      {inbox.data?.sources && <SourceList sources={inbox.data.sources} />}
    </>
  );
}
