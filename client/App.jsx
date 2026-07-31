import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Routes, useLocation, useNavigate } from './lib/router.jsx';
import { Layout } from './components/Layout.jsx';
import { Empty } from './components/States.jsx';

import Today from './pages/Today.jsx';
import Chat from './pages/Chat.jsx';
import { Businesses, BusinessDetail } from './pages/Businesses.jsx';
import { Projects, ProjectDetail } from './pages/Projects.jsx';
import Tasks from './pages/Tasks.jsx';
import Inbox from './pages/Inbox.jsx';
import Documents from './pages/Documents.jsx';
import Knowledge from './pages/Knowledge.jsx';
import Memory from './pages/Memory.jsx';
import Daily from './pages/Daily.jsx';
import Reports from './pages/Reports.jsx';
import Activity from './pages/Activity.jsx';
import Settings from './pages/Settings.jsx';

const ROUTES = [
  { path: '/today', element: Today },
  { path: '/chat', element: Chat },
  { path: '/businesses', element: Businesses },
  { path: '/businesses/:businessId', element: BusinessDetail },
  { path: '/projects', element: Projects },
  { path: '/projects/:projectId', element: ProjectDetail },
  { path: '/tasks', element: Tasks },
  { path: '/inbox', element: Inbox },
  { path: '/documents', element: Documents },
  { path: '/documents/*', element: Documents },
  { path: '/knowledge', element: Knowledge },
  { path: '/memory', element: Memory },
  { path: '/daily', element: Daily },
  { path: '/reports', element: Reports },
  { path: '/activity', element: Activity },
  { path: '/settings', element: Settings }
];

function NotFound() {
  return (
    <Empty
      title="Page not found"
      description="That route does not exist in the Nexus command center."
    />
  );
}

function Workspace() {
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') navigate('/today', { replace: true });
  }, [location.pathname, navigate]);

  return (
    <Layout>
      <Routes routes={ROUTES} fallback={<NotFound />} />
    </Layout>
  );
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => {
          // Validation, policy, and conflict failures are not transient.
          if (error?.code && error.code !== 'NETWORK_ERROR') return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
        staleTime: 10_000
      }
    }
  });
}

export default function App({ queryClient = createQueryClient(), initialPath }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Router initialPath={initialPath}>
        <Workspace />
      </Router>
    </QueryClientProvider>
  );
}

export { ROUTES };
