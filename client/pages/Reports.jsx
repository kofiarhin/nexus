import React, { useState } from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card, Field, SourceList } from '../components/Primitives.jsx';
import { ErrorState, Loading } from '../components/States.jsx';
import { Markdown } from '../lib/markdown.jsx';
import { useBusinesses, useProjects, useReport } from '../lib/queries.js';

const TYPES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'project', label: 'Project' },
  { value: 'business', label: 'Business' },
  { value: 'activity', label: 'Activity' }
];

function Facts({ facts }) {
  return (
    <dl className="definition-grid">
      {Object.entries(facts ?? {}).map(([key, value]) => (
        <React.Fragment key={key}>
          <dt>{key}</dt>
          <dd>
            {Array.isArray(value) ? (
              value.length === 0 ? (
                <span className="muted">none</span>
              ) : (
                <ul className="plain-list">
                  {value.map((item, index) => (
                    <li key={`${key}-${index}`}>
                      {typeof item === 'object' ? item.name ?? JSON.stringify(item) : String(item)}
                    </li>
                  ))}
                </ul>
              )
            ) : (
              String(value)
            )}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export default function Reports() {
  const [type, setType] = useState('daily');
  const [id, setId] = useState('');
  const [narrative, setNarrative] = useState(false);

  const projects = useProjects();
  const businesses = useBusinesses();
  const report = useReport({ type, id: id || undefined, narrative });

  const needsId = type === 'project' || type === 'business';
  const options = type === 'project'
    ? (projects.data?.projects ?? []).map((project) => ({ value: project.slug, label: project.name }))
    : (businesses.data?.businesses ?? []).map((business) => ({ value: business.id, label: business.name }));

  return (
    <>
      <PageHeader
        title="Reports"
        description="Computed from current Vault records. Facts and AI recommendations stay separate."
      />

      <Card title="Report options">
        <div className="form-grid">
          <Field label="Type">
            <select value={type} onChange={(event) => { setType(event.target.value); setId(''); }}>
              {TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          {needsId && (
            <Field label={type === 'project' ? 'Project' : 'Business'}>
              <select value={id} onChange={(event) => setId(event.target.value)}>
                <option value="">Select…</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Narrative">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={narrative}
                onChange={(event) => setNarrative(event.target.checked)}
              />
              Include an AI narrative (labelled as a recommendation)
            </label>
          </Field>
        </div>
      </Card>

      {needsId && !id ? (
        <Card>
          <p className="muted">Select a {type} to generate this report.</p>
        </Card>
      ) : report.isPending ? (
        <Loading label="Generating report…" />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={report.refetch} />
      ) : (
        <>
          <Card title={`${report.data.report.type} report`} description={`Generated ${report.data.report.generatedAt}`}>
            <p>
              <Badge tone="success">Facts</Badge> Computed deterministically from Vault records.
            </p>
            <Facts facts={report.data.report.facts} />
          </Card>

          {report.data.report.narrative && (
            <Card title="Narrative">
              <p>
                <Badge tone="warning">AI recommendation</Badge> Generated prose, not an authoritative record.
              </p>
              <Markdown content={report.data.report.narrative.text} />
              <SourceList
                sources={report.data.report.narrative.citations.map((citation) => ({
                  path: citation.path,
                  sha: citation.sha,
                  reason: `Cited as [${citation.marker}]`
                }))}
                title="Citations"
              />
            </Card>
          )}

          {narrative && !report.data.report.aiAvailable && (
            <Card>
              <p className="notice">
                The reasoning provider is not configured, so no narrative was generated. The deterministic facts above
                remain complete.
              </p>
            </Card>
          )}

          <SourceList sources={report.data.report.sources} />
        </>
      )}
    </>
  );
}
