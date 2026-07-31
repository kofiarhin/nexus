import React, { useEffect, useState } from 'react';
import { resolveProjectsState } from './lib/projectsState.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api/v1';

const EMPTY_MESSAGE = {
  'missing-registry': 'The Vault is connected, but it has no registry/PROJECTS.md yet. Add that file to list projects.',
  'no-projects': 'No projects are registered yet. Add a row to registry/PROJECTS.md to list one.'
};

export default function App() {
  const [{ status, projects, reason }, setState] = useState({ status: 'loading', projects: [] });

  useEffect(() => {
    let active = true;

    fetch(`${API_BASE_URL}/projects`)
      .then(async (response) => ({ ok: response.ok, payload: await response.json() }))
      .then((result) => {
        if (active) setState(resolveProjectsState(result));
      })
      .catch(() => {
        if (active) setState({ status: 'error', projects: [] });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Nexus Foundation MVP</p>
        <h1>Your knowledge, portable and project-aware.</h1>
        <p>Nexus reads canonical Markdown from GitHub and keeps deterministic retrieval separate from AI reasoning.</p>
      </header>
      <section>
        <h2>Vault projects</h2>
        {status === 'loading' && <p>Loading projects…</p>}
        {status === 'unconfigured' && <p>The Vault is not configured yet. Add GitHub environment variables to connect it.</p>}
        {status === 'empty' && <p>{EMPTY_MESSAGE[reason] ?? EMPTY_MESSAGE['no-projects']}</p>}
        {status === 'upstream-error' && <p>The Vault is temporarily unavailable. Try again shortly.</p>}
        {status === 'error' && <p>Projects could not be loaded. Check that the API is running and try again.</p>}
        {status === 'ready' && (
          <ul>
            {projects.map((project) => (
              <li key={project.slug}>
                <strong>{project.name}</strong>
                <span>{project.summary || 'No summary documented'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
