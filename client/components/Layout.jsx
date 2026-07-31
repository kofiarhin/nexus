import React, { useState } from 'react';
import { Link, NavLink, useLocation } from '../lib/router.jsx';

const NAVIGATION = [
  { to: '/today', label: 'Today' },
  { to: '/chat', label: 'Chat' },
  { to: '/businesses', label: 'Businesses' },
  { to: '/projects', label: 'Projects' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/documents', label: 'Documents' },
  { to: '/knowledge', label: 'Knowledge' },
  { to: '/memory', label: 'Memory' },
  { to: '/daily', label: 'Daily Notes' },
  { to: '/reports', label: 'Reports' },
  { to: '/activity', label: 'Activity' },
  { to: '/settings', label: 'Settings' }
];

/**
 * Command-center shell: persistent sidebar, main workspace, and an optional
 * assistant panel. On small viewports the sidebar collapses behind a toggle.
 */
export function Layout({ children, assistant }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="shell">
      <a className="skip-link" href="#workspace">
        Skip to main content
      </a>

      <header className="topbar">
        <button
          type="button"
          className="button button-ghost nav-toggle"
          aria-expanded={navigationOpen}
          aria-controls="primary-navigation"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
        <Link to="/today" className="brand">
          Nexus
        </Link>
        <div className="topbar-meta" />
      </header>

      <div className="body">
        <nav
          id="primary-navigation"
          className={navigationOpen ? 'sidebar is-open' : 'sidebar'}
          aria-label="Primary"
        >
          <ul>
            {NAVIGATION.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} onClick={() => setNavigationOpen(false)}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="workspace" className="workspace" tabIndex={-1} key={location.pathname}>
          {children}
        </main>

        {assistant && <aside className="assistant" aria-label="Nexus assistant">{assistant}</aside>}
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export { NAVIGATION };
