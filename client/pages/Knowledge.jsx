import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Card, SourceList } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { Link } from '../lib/router.jsx';
import { useKnowledge, useKnowledgeNote, useSearch } from '../lib/queries.js';

export default function Knowledge() {
  const notes = useKnowledge();
  const [selected, setSelected] = useState(null);
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');

  const note = useKnowledgeNote(selected);
  const search = useSearch(submitted ? { q: submitted, scope: 'knowledge' } : null);

  return (
    <>
      <PageHeader title="Knowledge" description="Durable reference notes with linked discovery." />

      <Card title="Search knowledge">
        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(term.trim());
          }}
        >
          <label className="visually-hidden" htmlFor="knowledge-search">
            Search knowledge notes
          </label>
          <input
            id="knowledge-search"
            type="search"
            value={term}
            placeholder="Search note text…"
            onChange={(event) => setTerm(event.target.value)}
          />
          <button type="submit" className="button button-primary">
            Search
          </button>
        </form>

        {search.isPending && submitted && <Loading label="Searching…" />}
        {search.isError && <ErrorState error={search.error} compact />}
        {search.data && (
          <>
            <p className="muted">
              Layers used: {search.data.layers.join(', ') || 'none'} · scanned {search.data.scanned} documents
              {search.data.truncated ? ' (bounded)' : ''}
            </p>
            <ul className="plain-list">
              {search.data.results.map((result) => (
                <li key={result.path}>
                  <button type="button" className="link-button" onClick={() => setSelected(result.path)}>
                    {result.title ?? result.path}
                  </button>
                  <span className="muted"> — {result.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="documents-layout">
        <Card title="Notes" className="documents-tree">
          {notes.isPending && <Loading label="Loading notes…" />}
          {notes.isError && <ErrorState error={notes.error} onRetry={notes.refetch} />}
          {notes.isSuccess && notes.data.notes.length === 0 && (
            <Empty title="No knowledge notes" description="Add Markdown files under knowledge/ in your Vault." />
          )}
          <ul className="plain-list">
            {(notes.data?.notes ?? []).map((item) => (
              <li key={item.path}>
                <button
                  type="button"
                  className={item.path === selected ? 'link-button is-active' : 'link-button'}
                  onClick={() => setSelected(item.path)}
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="documents-main">
          {!selected ? (
            <Empty title="No note selected" description="Choose a knowledge note to read it." />
          ) : note.isPending ? (
            <Loading label="Loading note…" />
          ) : note.isError ? (
            <ErrorState error={note.error} onRetry={note.refetch} />
          ) : (
            <>
              <h2>{note.data.note.title}</h2>
              <p className="muted">
                <code>{note.data.note.path}</code>
                {note.data.note.tags.length > 0 && <> · tags: {note.data.note.tags.join(', ')}</>}
              </p>
              <Markdown content={note.data.note.content} />

              <Card title="Outgoing links">
                {note.data.note.links.length === 0 ? (
                  <p className="muted">No links recorded in this note.</p>
                ) : (
                  <ul className="plain-list">
                    {note.data.note.links.map((link) => (
                      <li key={link}>{link}</li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Backlinks" description="Documents elsewhere in the Vault that mention this note.">
                {note.data.note.backlinks.length === 0 ? (
                  <p className="muted">No backlinks found.</p>
                ) : (
                  <ul className="plain-list">
                    {note.data.note.backlinks.map((backlink) => (
                      <li key={backlink.path}>
                        <Link to={`/documents/${backlink.path}`}>{backlink.title ?? backlink.path}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <SourceList sources={note.data.note.sources} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
