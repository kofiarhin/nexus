import React from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, SourceList } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { Link } from '../lib/router.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { useProject, useProjects, useTasks } from '../lib/queries.js';

export function Projects() {
  const projects = useProjects();

  if (projects.isPending) return <Loading label="Loading projects…" />;
  if (projects.isError) return <ErrorState error={projects.error} onRetry={projects.refetch} />;

  const list = projects.data.projects ?? [];

  return (
    <>
      <PageHeader title="Projects" description="Parsed deterministically from the Vault project registry." />
      {list.length === 0 ? (
        <Empty
          title="No projects registered"
          description="Add a row to registry/PROJECTS.md in your Vault to list a project here."
        />
      ) : (
        <div className="grid grid-2">
          {list.map((project) => (
            <Card key={project.slug} title={<Link to={`/projects/${project.slug}`}>{project.name}</Link>}>
              <p>{project.summary || 'No summary documented.'}</p>
              <p className="muted">
                <code>{project.path}</code>
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ListSection({ title, items }) {
  return (
    <Card title={title}>
      {items.length === 0 ? (
        <p className="muted">Nothing recorded.</p>
      ) : (
        <ul className="plain-list">
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ProjectDetail({ params }) {
  const project = useProject(params.projectId);
  const tasks = useTasks({ projectId: params.projectId });

  if (project.isPending) return <Loading label="Loading project…" />;
  if (project.isError) return <ErrorState error={project.error} onRetry={project.refetch} />;

  const detail = project.data.project;

  return (
    <>
      <PageHeader
        title={detail.name}
        description={detail.summary}
        actions={
          <>
            <Link className="button" to={`/documents/${detail.path}`}>
              Open document
            </Link>
            <Link className="button" to={`/chat?scope=project&id=${detail.id}`}>
              Project chat
            </Link>
          </>
        }
      />

      <Card title="Snapshot">
        <dl className="definition-grid">
          <dt>Lifecycle</dt>
          <dd>
            <Badge tone="neutral">{detail.lifecycle}</Badge>
          </dd>
          <dt>Document</dt>
          <dd>
            <code>{detail.path}</code>
          </dd>
          <dt>Revision</dt>
          <dd>{detail.revision ? <code>{detail.revision.slice(0, 10)}</code> : '—'}</dd>
          <dt>Updated</dt>
          <dd>{detail.updatedAt ?? '—'}</dd>
        </dl>
        {detail.documentMissing && (
          <p className="notice">
            The registry references <code>{detail.path}</code>, but that document does not exist in the Vault yet.
          </p>
        )}
      </Card>

      {detail.currentState && (
        <Card title="Current state">
          <Markdown content={detail.currentState} />
        </Card>
      )}
      {detail.currentFocus && (
        <Card title="Current focus">
          <Markdown content={detail.currentFocus} />
        </Card>
      )}

      <div className="grid grid-2">
        <ListSection title="Roadmap" items={detail.roadmap ?? []} />
        <ListSection title="Decisions" items={detail.decisions ?? []} />
        <ListSection title="Assumptions" items={detail.assumptions ?? []} />
        <ListSection title="Open questions" items={detail.openQuestions ?? []} />
      </div>

      <Card title="Tasks" actions={<Link to={`/tasks?projectId=${detail.id}`}>Manage tasks</Link>}>
        {tasks.isPending && <Loading label="Loading tasks…" />}
        {tasks.isError && <ErrorState error={tasks.error} compact />}
        {tasks.data?.tasks?.length === 0 && <p className="muted">No tasks reference this project.</p>}
        <ul className="task-list">
          {(tasks.data?.tasks ?? []).map((task) => (
            <li key={task.id} className="task-row">
              <span>{task.name}</span>
              <span className="task-meta">
                <Badge tone="neutral">{task.status}</Badge>
                {task.dueDate && <span className="muted">due {task.dueDate}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <SourceList sources={detail.sources} />
    </>
  );
}
