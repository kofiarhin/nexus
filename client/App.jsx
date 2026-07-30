import React, { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000/api/v1';

export default function App() {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    fetch(`${API_BASE_URL}/projects`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error?.message ?? 'Unable to load projects');
        return payload.data.projects;
      })
      .then((items) => {
        setProjects(items);
        setStatus('ready');
      })
      .catch(() => setStatus('unavailable'));
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
        {status === 'unavailable' && <p>The Vault is not configured yet. Add GitHub environment variables to connect it.</p>}
        {status === 'ready' && (projects.length ? (
          <ul>{projects.map((project) => <li key={project.slug}><strong>{project.name}</strong><span>{project.summary || 'No summary documented'}</span></li>)}</ul>
        ) : <p>No projects are registered yet.</p>)}
      </section>
    </main>
  );
}
