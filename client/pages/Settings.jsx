import React from 'react';
import { PageHeader } from '../components/Layout.jsx';
import { Badge, Card } from '../components/Primitives.jsx';
import { ErrorState, Loading } from '../components/States.jsx';
import { useSettings } from '../lib/queries.js';

const yesNo = (value) => (value ? <Badge tone="success">enabled</Badge> : <Badge tone="neutral">disabled</Badge>);
const fallback = 'not set';

export default function Settings() {
  const settings = useSettings();

  if (settings.isPending) return <Loading label="Loading settings..." />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={settings.refetch} />;

  const data = settings.data;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Configuration is read-only here. Values are set through server environment variables; secrets are never returned."
      />

      <Card title="Vault">
        <dl className="definition-grid">
          <dt>Repository</dt>
          <dd>{data.vault.repository ?? fallback}</dd>
          <dt>Branch</dt>
          <dd>{data.vault.branch}</dd>
          <dt>Connection</dt>
          <dd>{data.vault.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warning">not configured</Badge>}</dd>
          <dt>Readable paths</dt>
          <dd>
            <code>{data.vault.readPaths.join(', ')}</code>
          </dd>
          <dt>Writable paths</dt>
          <dd>
            <code>{data.vault.writePaths.join(', ')}</code>
          </dd>
        </dl>
        <p className="notice notice-warning">
          MVP endpoints are public. Keep the API and Vault repository private before storing personal, client, financial, or operational records.
        </p>
      </Card>

      <Card title="Reasoning provider">
        <dl className="definition-grid">
          <dt>Provider</dt>
          <dd>{data.reasoning.provider}</dd>
          <dt>Status</dt>
          <dd>{data.reasoning.configured ? <Badge tone="success">configured</Badge> : <Badge tone="warning">not configured</Badge>}</dd>
          <dt>Model</dt>
          <dd>{data.reasoning.model ?? fallback}</dd>
          <dt>Timeout</dt>
          <dd>{data.reasoning.timeoutMs} ms</dd>
        </dl>
        {!data.reasoning.configured && (
          <p className="notice">
            Set <code>NVIDIA_API_KEY</code> and optionally <code>NVIDIA_MODEL</code> to enable conversation, planning
            narratives, and operation proposals. Deterministic reads and administration work without it.
          </p>
        )}
      </Card>

      <Card title="Operations and approvals">
        <dl className="definition-grid">
          <dt>Write operations</dt>
          <dd>{yesNo(data.operations.writeOperationsEnabled)}</dd>
          <dt>Destructive operations</dt>
          <dd>{yesNo(data.operations.destructiveOperationsEnabled)}</dd>
          <dt>Combine approval and execution for low risk</dt>
          <dd>{yesNo(data.operations.autoApproveLowRisk)}</dd>
          <dt>Allowed actions</dt>
          <dd>
            {data.operations.allowedActions.length === 0 ? (
              <span className="muted">none</span>
            ) : (
              <code>{data.operations.allowedActions.join(', ')}</code>
            )}
          </dd>
        </dl>
      </Card>

      <Card title="Retrieval limits">
        <dl className="definition-grid">
          <dt>Max context sources</dt>
          <dd>{data.context.maxSources}</dd>
          <dt>Max context characters</dt>
          <dd>{data.context.maxCharacters}</dd>
          <dt>Max files scanned per search</dt>
          <dd>{data.context.searchMaxFiles}</dd>
        </dl>
        <p className="muted">The whole Vault is never loaded into a model request.</p>
      </Card>
    </>
  );
}
