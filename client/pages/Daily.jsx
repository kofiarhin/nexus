import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Card, Field } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { runMutation, useAppendDailyEntry, useDailyNote, useDailyNotes } from '../lib/queries.js';

const SECTIONS = ['Plan', 'Notes', 'Events', 'Outcomes', 'Reflections'];

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function Daily() {
  const notes = useDailyNotes();
  const [date, setDate] = useState(todayIso());
  const note = useDailyNote(date);
  const append = useAppendDailyEntry();

  const [section, setSection] = useState('Notes');
  const [content, setContent] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!content.trim()) return;
    if (!await runMutation(append, { date, section, content })) return;
    setContent('');
    note.refetch();
  };

  return (
    <>
      <PageHeader title="Daily notes" description="Plans, notes, events, outcomes, and reflections per day." />

      <Card title="Select a day">
        <Field label="Date">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        {notes.isPending && <Loading label="Loading recent days…" />}
        {notes.isError && <ErrorState error={notes.error} compact />}
        {notes.data?.notes?.length > 0 && (
          <ul className="plain-list inline-list">
            {notes.data.notes.map((entry) => (
              <li key={entry.date}>
                <button
                  type="button"
                  className={entry.date === date ? 'link-button is-active' : 'link-button'}
                  onClick={() => setDate(entry.date)}
                >
                  {entry.date}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Add an entry to ${date}`}>
        <form onSubmit={submit}>
          <Field label="Section">
            <select value={section} onChange={(event) => setSection(event.target.value)}>
              {SECTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entry" required>
            <textarea rows={2} value={content} onChange={(event) => setContent(event.target.value)} />
          </Field>
          <button type="submit" className="button button-primary" disabled={append.isPending}>
            Append entry
          </button>
        </form>
        {append.isError && <ErrorState error={append.error} compact />}
      </Card>

      <Card title={date}>
        {note.isPending && <Loading label="Loading daily note…" />}
        {note.isError && <ErrorState error={note.error} onRetry={note.refetch} />}
        {note.isSuccess && !note.data.note.exists && (
          <Empty
            title="No note for this day yet"
            description="Append an entry to create the daily note in your Vault."
          />
        )}
        {note.isSuccess && note.data.note.exists && (
          <>
            <p className="muted">
              <code>{note.data.note.path}</code> @<code>{String(note.data.note.revision).slice(0, 10)}</code>
            </p>
            <Markdown content={note.data.note.content} />
          </>
        )}
      </Card>
    </>
  );
}
