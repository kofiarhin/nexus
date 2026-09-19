import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Card, Dialog, Field, SourceList } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { OperationReview } from '../components/OperationReview.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { Link, useNavigate } from '../lib/router.jsx';
import { runMutation, useVaultFile, useVaultHistory, useVaultMutation, useVaultTree } from '../lib/queries.js';

function TreeNode({ node, activePath }) {
  const [open, setOpen] = useState(true);

  if (node.type === 'file') {
    return (
      <li>
        <Link
          to={`/documents/${node.path}`}
          className={node.path === activePath ? 'tree-file is-active' : 'tree-file'}
        >
          {node.name}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <button type="button" className="tree-dir" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {node.name}
      </button>
      {open && (
        <ul className="tree">
          {(node.children ?? []).map((child) => (
            <TreeNode key={child.path} node={child} activePath={activePath} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function Documents({ params }) {
  const navigate = useNavigate();
  const activePath = params['*'] || '';

  const tree = useVaultTree('');
  const file = useVaultFile(activePath);
  const history = useVaultHistory(activePath);

  const replace = useVaultMutation('/vault/files', 'PUT');
  const create = useVaultMutation('/vault/files', 'POST');
  const append = useVaultMutation('/vault/files/append');
  const move = useVaultMutation('/vault/files/move');
  const archive = useVaultMutation('/vault/files/archive');
  const remove = useVaultMutation('/vault/files', 'DELETE');
  const restore = useVaultMutation('/vault/files/restore');

  const [mode, setMode] = useState('read');
  const [editorValue, setEditorValue] = useState('');
  const [operation, setOperation] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [dialogValue, setDialogValue] = useState('');

  const document = file.data?.file;

  useEffect(() => {
    if (document) {
      setEditorValue(document.content);
      setMode('read');
    }
  }, [document?.path, document?.revision]);

  const mutations = [replace, create, append, move, archive, remove, restore];
  const busy = mutations.some((mutation) => mutation.isPending);
  const mutationError = mutations.map((mutation) => mutation.error).find(Boolean);

  // A failed mutation leaves its error on the mutation state, which is
  // rendered below; `result` is null in that case and nothing is refetched.
  const handleResult = (result) => {
    setOperation(result?.operation ?? null);
    if (result?.executed) {
      file.refetch();
      history.refetch();
      tree.refetch();
    }
  };

  const save = async () => {
    handleResult(await runMutation(replace, {
      path: document.path,
      content: editorValue,
      expectedSha: document.revision,
      reason: 'Manual document edit'
    }));
  };

  const runDialogAction = async () => {
    if (dialog === 'create') {
      const result = await runMutation(create, {
        path: dialogValue,
        content: `# ${dialogValue.split('/').pop().replace(/\.md$/i, '')}\n\n`,
        reason: 'Create document'
      });
      handleResult(result);
      if (result?.executed) navigate(`/documents/${dialogValue}`);
    } else if (dialog === 'append') {
      handleResult(await runMutation(append, {
        path: document.path,
        content: dialogValue,
        expectedSha: document.revision,
        reason: 'Append to document'
      }));
    } else if (dialog === 'move') {
      handleResult(await runMutation(move, {
        path: document.path,
        destinationPath: dialogValue,
        expectedSha: document.revision,
        reason: 'Move document'
      }));
    }
    setDialog(null);
    setDialogValue('');
  };

  return (
    <>
      <PageHeader
        title="Documents"
        description="Browse, read, and administer canonical Markdown in the Vault."
        actions={
          <button type="button" className="button button-primary" onClick={() => { setDialog('create'); setDialogValue(''); }}>
            New document
          </button>
        }
      />

      <div className="documents-layout">
        <Card title="Vault" className="documents-tree">
          {tree.isPending && <Loading label="Loading Vault tree…" />}
          {tree.isError && <ErrorState error={tree.error} onRetry={tree.refetch} compact />}
          {tree.data?.entries?.length === 0 && <p className="muted">No readable documents were found.</p>}
          <ul className="tree tree-root">
            {(tree.data?.entries ?? []).map((node) => (
              <TreeNode key={node.path} node={node} activePath={activePath} />
            ))}
          </ul>
        </Card>

        <Card className="documents-main">
          {!activePath ? (
            <Empty title="No document selected" description="Choose a document from the Vault tree." />
          ) : file.isPending ? (
            <Loading label="Loading document…" />
          ) : file.isError ? (
            <ErrorState error={file.error} onRetry={file.refetch} />
          ) : (
            <>
              <div className="toolbar">
                <div>
                  <h2>{document.title ?? document.path}</h2>
                  <p className="muted">
                    <code>{document.path}</code> @<code>{String(document.revision).slice(0, 10)}</code>
                    {!document.writable && ' · read only'}
                  </p>
                </div>
                <div className="segmented">
                  <button
                    type="button"
                    className={mode === 'read' ? 'segment is-active' : 'segment'}
                    onClick={() => setMode('read')}
                  >
                    Read
                  </button>
                  <button
                    type="button"
                    className={mode === 'edit' ? 'segment is-active' : 'segment'}
                    onClick={() => setMode('edit')}
                    disabled={!document.writable}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={mode === 'preview' ? 'segment is-active' : 'segment'}
                    onClick={() => setMode('preview')}
                  >
                    Preview
                  </button>
                </div>
              </div>

              {mode === 'read' && <Markdown content={document.content} />}
              {mode === 'preview' && <Markdown content={editorValue} />}
              {mode === 'edit' && (
                <>
                  <label className="visually-hidden" htmlFor="document-editor">
                    Document content
                  </label>
                  <textarea
                    id="document-editor"
                    className="editor"
                    rows={24}
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                  />
                  <div className="operation-actions">
                    <button type="button" className="button button-primary" onClick={save} disabled={busy}>
                      Propose replacement
                    </button>
                    <button type="button" className="button" onClick={() => setEditorValue(document.content)}>
                      Discard changes
                    </button>
                  </div>
                </>
              )}

              {document.writable && (
                <div className="operation-actions">
                  <button type="button" className="button" onClick={() => { setDialog('append'); setDialogValue(''); }}>
                    Append…
                  </button>
                  <button type="button" className="button" onClick={() => { setDialog('move'); setDialogValue(document.path); }}>
                    Move…
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={async () => handleResult(await runMutation(archive, {
                      path: document.path,
                      expectedSha: document.revision,
                      reason: 'Archive document'
                    }))}
                  >
                    Archive…
                  </button>
                  <button
                    type="button"
                    className="button button-danger"
                    disabled={busy}
                    onClick={async () => handleResult(await runMutation(remove, {
                      path: document.path,
                      expectedSha: document.revision,
                      reason: 'Delete document'
                    }))}
                  >
                    Delete…
                  </button>
                </div>
              )}

              {mutationError && <ErrorState error={mutationError} compact />}

              {operation && (
                <Card title="Proposed change" description="Review the diff before this is written to the Vault.">
                  <OperationReview
                    operation={operation}
                    onChanged={(result) => {
                      setOperation(result.operation ?? result);
                      file.refetch();
                      history.refetch();
                    }}
                  />
                </Card>
              )}

              <Card title="Revisions" description="Git history is the revision and rollback record.">
                {history.isPending && <Loading label="Loading history…" />}
                {history.isError && <ErrorState error={history.error} compact />}
                {history.data?.revisions?.length === 0 && <p className="muted">No commits recorded for this path.</p>}
                <ul className="plain-list">
                  {(history.data?.revisions ?? []).map((revision) => (
                    <li key={revision.revision} className="revision-row">
                      <code>{revision.revision.slice(0, 10)}</code> {revision.message.split('\n')[0]}
                      <span className="muted"> · {revision.date}</span>
                      {document.writable && (
                        <button
                          type="button"
                          className="button button-ghost"
                          disabled={busy}
                          onClick={async () => handleResult(await runMutation(restore, {
                            path: document.path,
                            revision: revision.revision,
                            expectedSha: document.revision,
                            reason: `Restore ${revision.revision.slice(0, 7)}`
                          }))}
                        >
                          Restore
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>

              <SourceList sources={document.sources} />
            </>
          )}
        </Card>
      </div>

      <Dialog
        open={Boolean(dialog)}
        title={dialog === 'create' ? 'New document' : dialog === 'append' ? 'Append content' : 'Move document'}
        onClose={() => setDialog(null)}
        footer={
          <>
            <button type="button" className="button" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button type="button" className="button button-primary" onClick={runDialogAction} disabled={busy || !dialogValue}>
              Propose
            </button>
          </>
        }
      >
        {dialog === 'append' ? (
          <Field label="Content to append" hint="Appending identical content again is a no-op.">
            <textarea rows={5} value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} />
          </Field>
        ) : (
          <Field
            label={dialog === 'create' ? 'New document path' : 'Destination path'}
            hint="Repository-relative, for example knowledge/topic.md"
          >
            <input type="text" value={dialogValue} onChange={(event) => setDialogValue(event.target.value)} />
          </Field>
        )}
      </Dialog>
    </>
  );
}
