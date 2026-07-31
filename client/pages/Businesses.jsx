import React from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, SourceList, statusTone } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { Link } from '../lib/router.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { useBusiness, useBusinesses, useReport, useTasks } from '../lib/queries.js';

export function Businesses() {
  const businesses = useBusinesses();

  if (businesses.isPending) return <Loading label="Loading businesses…" />;
  if (businesses.isError) return <ErrorState error={businesses.error} onRetry={businesses.refetch} />;

  const list = businesses.data.businesses ?? [];

  return (
    <>
      <PageHeader title="Businesses" description="Operational overview across each registered business." />
      {list.length === 0 ? (
        <Empty
          title="No businesses registered"
          description={
            businesses.data.registered
              ? 'registry/BUSINESSES.md exists but has no rows yet.'
              : 'Add registry/BUSINESSES.md to your Vault to register a business.'
          }
        />
      ) : (
        <div className="grid grid-2">
          {list.map((business) => (
            <Card key={business.id} title={<Link to={`/businesses/${business.id}`}>{business.name}</Link>}>
              <p>{business.summary || 'No summary documented.'}</p>
              <p>
                <Badge tone={statusTone(business.status)}>{business.status || 'unknown'}</Badge>{' '}
                <code>{business.path}</code>
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ListCard({ title, items }) {
  return (
    <Card title={title}>
      {(!items || items.length === 0) ? (
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

export function BusinessDetail({ params }) {
  const business = useBusiness(params.businessId);
  const tasks = useTasks({ businessId: params.businessId });
  const report = useReport({ type: 'business', id: params.businessId });

  if (business.isPending) return <Loading label="Loading business…" />;
  if (business.isError) return <ErrorState error={business.error} onRetry={business.refetch} />;

  const detail = business.data.business;

  return (
    <>
      <PageHeader
        title={detail.name}
        description={detail.purpose}
        actions={
          <>
            <Link className="button" to={`/documents/${detail.path}`}>
              Open document
            </Link>
            <Link className="button" to={`/chat?scope=business&id=${detail.id}`}>
              Business chat
            </Link>
          </>
        }
      />

      <Card title="Overview">
        <dl className="definition-grid">
          <dt>Status</dt>
          <dd>
            <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
          </dd>
          <dt>Document</dt>
          <dd>
            <code>{detail.path}</code>
          </dd>
          <dt>Updated</dt>
          <dd>{detail.updatedAt ?? '—'}</dd>
        </dl>
        {detail.documentMissing && (
          <p className="notice">
            The registry references <code>{detail.path}</code>, but that document does not exist yet.
          </p>
        )}
      </Card>

      {detail.strategy && (
        <Card title="Strategy">
          <Markdown content={detail.strategy} />
        </Card>
      )}

      <div className="grid grid-2">
        <ListCard title="Goals" items={detail.goals} />
        <ListCard title="Products and services" items={detail.products} />
        <ListCard title="Metrics" items={detail.metrics} />
        <ListCard title="Risks" items={detail.risks} />
        <ListCard title="Blockers" items={detail.blockers} />
        <ListCard title="Operating procedures" items={detail.procedures} />
      </div>

      <Card title="Tasks" actions={<Link to={`/tasks?businessId=${detail.id}`}>Manage tasks</Link>}>
        {tasks.isPending && <Loading label="Loading tasks…" />}
        {tasks.data?.tasks?.length === 0 && <p className="muted">No tasks reference this business.</p>}
        <ul className="task-list">
          {(tasks.data?.tasks ?? []).map((task) => (
            <li key={task.id} className="task-row">
              <span>{task.name}</span>
              <span className="task-meta">
                <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                {task.dueDate && <span className="muted">due {task.dueDate}</span>}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Business report" description="Computed from current Vault records.">
        {report.isPending && <Loading label="Generating report…" />}
        {report.isError && <ErrorState error={report.error} compact />}
        {report.data && (
          <dl className="definition-grid">
            <dt>Open tasks</dt>
            <dd>{report.data.report.facts.openTasks}</dd>
            <dt>Metrics recorded</dt>
            <dd>{report.data.report.facts.metrics.length}</dd>
            <dt>Risks recorded</dt>
            <dd>{report.data.report.facts.risks.length}</dd>
          </dl>
        )}
      </Card>

      <SourceList sources={detail.sources} />
    </>
  );
}
