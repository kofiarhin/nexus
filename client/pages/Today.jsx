import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, SourceList, statusTone } from '../components/Primitives.jsx';
import { Empty, ErrorState, Loading } from '../components/States.jsx';
import { Link, useNavigate } from '../lib/router.jsx';
import { runMutation, usePlanningToday, useCreateConversation } from '../lib/queries.js';

function TaskRow({ task }) {
  return (
    <li className="task-row">
      <Link to={`/tasks?focus=${encodeURIComponent(task.id)}`}>{task.name}</Link>
      <span className="task-meta">
        <Badge tone={statusTone(task.status)}>{task.status}</Badge>
        <Badge tone={task.priority === 'critical' || task.priority === 'high' ? 'warning' : 'neutral'}>
          {task.priority}
        </Badge>
        {task.dueDate && <span className="muted">due {task.dueDate}</span>}
      </span>
    </li>
  );
}

function TaskList({ tasks, emptyLabel }) {
  if (!tasks || tasks.length === 0) return <p className="muted">{emptyLabel}</p>;
  return (
    <ul className="task-list">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </ul>
  );
}

export default function Today() {
  const plan = usePlanningToday();
  const createConversation = useCreateConversation();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');

  const askNexus = async (event) => {
    event.preventDefault();
    if (!question.trim()) return;
    const result = await runMutation(createConversation, {
      title: question.slice(0, 60),
      scope: { type: 'vault', ids: [] }
    });
    if (!result) return;
    navigate(`/chat?conversation=${result.conversation.id}&ask=${encodeURIComponent(question)}`);
  };

  if (plan.isPending) return <Loading label="Building today's plan…" />;
  if (plan.isError) return <ErrorState error={plan.error} onRetry={plan.refetch} />;

  const data = plan.data;

  return (
    <>
      <PageHeader
        title="Today"
        description={`${data.date} · ${data.counts.open} open, ${data.counts.overdue} overdue, ${data.counts.dueToday} due today`}
      />

      <Card title="Ask Nexus" description="Grounded in your Vault, with sources on every answer.">
        <form className="ask-form" onSubmit={askNexus}>
          <label className="visually-hidden" htmlFor="ask-nexus">
            Ask Nexus a question
          </label>
          <input
            id="ask-nexus"
            type="text"
            placeholder="What should I work on today?"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button type="submit" className="button button-primary" disabled={createConversation.isPending}>
            Ask
          </button>
        </form>
        {!data.aiAvailable && (
          <p className="notice">
            The reasoning provider is not configured. Everything below is computed deterministically from Vault
            records and remains available.
          </p>
        )}
        {createConversation.isError && <ErrorState error={createConversation.error} compact />}
      </Card>

      <Card
        title="Recommended priorities"
        description="Ranked deterministically from due dates, priority, and blockers. Every recommendation states its basis."
      >
        {data.recommendations.length === 0 ? (
          <Empty title="No open work" description="Nothing is currently open in your task records." />
        ) : (
          <ol className="recommendations">
            {data.recommendations.map((recommendation) => (
              <li key={recommendation.taskId}>
                <div className="recommendation-title">
                  <strong>{recommendation.title}</strong>
                  <Badge tone="neutral">{recommendation.basis}</Badge>
                </div>
                <ul className="reasons">
                  {recommendation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <SourceList sources={recommendation.sources} title="Source" />
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title={`Overdue (${data.overdue.length})`}>
          <TaskList tasks={data.overdue} emptyLabel="Nothing is overdue." />
        </Card>
        <Card title={`Due today (${data.dueToday.length})`}>
          <TaskList tasks={data.dueToday} emptyLabel="Nothing is due today." />
        </Card>
        <Card title={`Upcoming (${data.upcoming.length})`} description="Next seven days">
          <TaskList tasks={data.upcoming} emptyLabel="No deadlines in the next seven days." />
        </Card>
        <Card title={`Blockers (${data.blocked.length})`}>
          <TaskList tasks={data.blocked} emptyLabel="Nothing is blocked." />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Unresolved decisions" description="Open questions recorded in project documents">
          {data.unresolvedDecisions.length === 0 ? (
            <p className="muted">No open questions are recorded.</p>
          ) : (
            <ul className="plain-list">
              {data.unresolvedDecisions.map((decision, index) => (
                <li key={`${decision.projectId}-${index}`}>
                  <Link to={`/projects/${decision.projectId}`}>{decision.projectName}</Link>: {decision.question}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Business alerts">
          {data.businessAlerts.length === 0 ? (
            <p className="muted">No businesses are registered yet.</p>
          ) : (
            <ul className="plain-list">
              {data.businessAlerts.map((business) => (
                <li key={business.businessId}>
                  <Link to={`/businesses/${business.businessId}`}>{business.name}</Link>{' '}
                  <Badge tone={statusTone(business.status)}>{business.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent activity" actions={<Link to="/activity">View all</Link>}>
        {data.recentActivity.length === 0 ? (
          <p className="muted">No operations have been recorded in this session.</p>
        ) : (
          <ul className="plain-list">
            {data.recentActivity.map((event) => (
              <li key={event.id}>
                <Badge tone={statusTone(event.result)}>{event.result}</Badge> {event.action}{' '}
                <code>{event.path}</code> <span className="muted">{event.timestamp}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SourceList sources={data.sources} title="Vault sources used for this plan" />
    </>
  );
}
