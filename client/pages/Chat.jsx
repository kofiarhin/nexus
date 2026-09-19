import React, { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, Field, SourceList } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { OperationReview } from '../components/OperationReview.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { useNavigate } from '../lib/router.jsx';
import {
  runMutation,
  useBusinesses,
  useConversation,
  useConversations,
  useCreateConversation,
  useProjects,
  useSendMessage
} from '../lib/queries.js';

const SCOPE_LABELS = {
  vault: 'Whole Vault',
  project: 'Project',
  business: 'Business',
  document: 'Document',
  custom: 'Custom paths'
};

function ScopeSelector({ scope, onChange, projects, businesses }) {
  return (
    <div className="scope-selector">
      <Field label="Context scope">
        <select
          value={scope.type}
          onChange={(event) => onChange({ type: event.target.value, ids: [] })}
        >
          {Object.entries(SCOPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {scope.type === 'project' && (
        <Field label="Project">
          <select value={scope.ids[0] ?? ''} onChange={(event) => onChange({ ...scope, ids: [event.target.value] })}>
            <option value="">Select a project…</option>
            {(projects ?? []).map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {scope.type === 'business' && (
        <Field label="Business">
          <select value={scope.ids[0] ?? ''} onChange={(event) => onChange({ ...scope, ids: [event.target.value] })}>
            <option value="">Select a business…</option>
            {(businesses ?? []).map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {(scope.type === 'document' || scope.type === 'custom') && (
        <Field label="Vault paths" hint="Comma-separated repository-relative paths">
          <input
            type="text"
            value={scope.ids.join(', ')}
            placeholder="projects/nexus/PROJECT.md"
            onChange={(event) => onChange({
              ...scope,
              ids: event.target.value.split(',').map((item) => item.trim()).filter(Boolean)
            })}
          />
        </Field>
      )}
    </div>
  );
}

function Message({ message }) {
  const isUser = message.role === 'user';

  return (
    <article className={isUser ? 'message message-user' : 'message message-assistant'}>
      <header>
        <strong>{isUser ? 'You' : 'Nexus'}</strong>
        {message.model && <span className="muted"> · {message.model}</span>}
      </header>
      {isUser ? <p>{message.content}</p> : <Markdown content={message.content} />}
      {message.citations?.length > 0 && (
        <SourceList
          sources={message.citations.map((citation) => ({
            path: citation.path,
            sha: citation.sha,
            reason: `Cited as [${citation.marker}]`
          }))}
          title="Citations"
        />
      )}
    </article>
  );
}

export default function Chat({ query }) {
  const navigate = useNavigate();
  const conversations = useConversations();
  const projects = useProjects();
  const businesses = useBusinesses();
  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();

  const activeId = query.conversation ?? null;
  const conversation = useConversation(activeId);

  const [scope, setScope] = useState({ type: 'vault', ids: [] });
  const [draft, setDraft] = useState('');
  const [allowOperations, setAllowOperations] = useState(false);
  const [proposals, setProposals] = useState([]);
  const askedRef = useRef(null);
  const transcriptRef = useRef(null);

  const send = async (content) => {
    if (!activeId || !content.trim()) return;
    const result = await runMutation(sendMessage, { conversationId: activeId, content, allowOperations });
    // A failure keeps the draft so the message is not lost; the error renders
    // from the mutation state below.
    if (!result) return;
    setProposals(result.operations ?? []);
    setDraft('');
    conversation.refetch();
  };

  // A question typed on Today arrives as a query parameter and is sent once.
  useEffect(() => {
    if (!query.ask || !activeId || askedRef.current === query.ask) return;
    askedRef.current = query.ask;
    send(query.ask);
  }, [query.ask, activeId]);

  useEffect(() => {
    transcriptRef.current?.scrollTo?.(0, transcriptRef.current.scrollHeight);
  }, [conversation.data?.conversation?.messages?.length]);

  const startConversation = async () => {
    const result = await runMutation(createConversation, { title: 'New conversation', scope });
    if (result) navigate(`/chat?conversation=${result.conversation.id}`);
  };

  return (
    <>
      <PageHeader
        title="Chat"
        description="Answers are grounded in selected Vault context. Actions are proposed, never applied silently."
        actions={
          <button type="button" className="button button-primary" onClick={startConversation} disabled={createConversation.isPending}>
            New conversation
          </button>
        }
      />

      <div className="chat-layout">
        <Card title="Conversations" className="chat-sidebar">
          {conversations.isPending && <Loading label="Loading conversations…" />}
          {conversations.isError && <ErrorState error={conversations.error} compact />}
          {conversations.data?.conversations?.length === 0 && (
            <p className="muted">No conversations yet. Start one to begin.</p>
          )}
          <ul className="plain-list">
            {(conversations.data?.conversations ?? []).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === activeId ? 'link-button is-active' : 'link-button'}
                  onClick={() => navigate(`/chat?conversation=${item.id}`)}
                >
                  {item.title}
                </button>
                <span className="muted"> · {SCOPE_LABELS[item.scope?.type] ?? item.scope?.type}</span>
              </li>
            ))}
          </ul>

          <ScopeSelector
            scope={scope}
            onChange={setScope}
            projects={projects.data?.projects}
            businesses={businesses.data?.businesses}
          />
        </Card>

        <Card className="chat-main">
          {!activeId ? (
            <Empty
              title="No conversation selected"
              description="Choose a conversation, or start a new one with a context scope."
            />
          ) : conversation.isPending ? (
            <Loading label="Loading conversation…" />
          ) : conversation.isError ? (
            <ErrorState error={conversation.error} onRetry={conversation.refetch} />
          ) : (
            <>
              <div className="transcript" ref={transcriptRef} aria-live="polite">
                {conversation.data.conversation.messages.length === 0 && (
                  <p className="muted">Ask a question about your Vault to begin.</p>
                )}
                {conversation.data.conversation.messages.map((message) => (
                  <Message key={message.id} message={message} />
                ))}
                {sendMessage.isPending && <Loading label="Nexus is reading your Vault…" />}
              </div>

              {sendMessage.isError && <ErrorState error={sendMessage.error} compact />}

              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  send(draft);
                }}
              >
                <label className="visually-hidden" htmlFor="chat-input">
                  Message
                </label>
                <textarea
                  id="chat-input"
                  rows={3}
                  value={draft}
                  placeholder="Ask about your Vault, or describe a change to propose."
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div className="composer-actions">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={allowOperations}
                      onChange={(event) => setAllowOperations(event.target.checked)}
                    />
                    Allow Nexus to propose Vault changes
                  </label>
                  <button type="submit" className="button button-primary" disabled={sendMessage.isPending}>
                    Send
                  </button>
                </div>
              </form>
            </>
          )}
        </Card>
      </div>

      {proposals.length > 0 && (
        <Card
          title="Proposed operations"
          description="Nexus proposed these changes. Nothing is written until you approve and execute."
        >
          <p className="notice">
            <Badge tone="warning">Proposal</Badge> A proposal is not evidence that anything changed.
          </p>
          {proposals.map((operation) => (
            <OperationReview
              key={operation.id}
              operation={operation}
              onChanged={(updated) => setProposals((current) => current.map(
                (item) => (item.id === (updated.operation?.id ?? updated.id) ? updated.operation ?? updated : item)
              ))}
            />
          ))}
        </Card>
      )}
    </>
  );
}
