import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from '../../client/lib/router.jsx';

/**
 * Renders a component against a stubbed API.
 *
 * `routes` maps `METHOD /path` (or just `/path` for GET) onto either a data
 * object or `{ status, error }`, so a test can drive loading, empty, error,
 * permission, and conflict states through the real query layer.
 */
export function createApiStub(routes = {}) {
  const calls = [];

  const handler = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const path = String(url).replace('http://localhost:5000/api/v1', '');
    calls.push({ method, path, body: options.body ? JSON.parse(options.body) : null });

    const route = routes[`${method} ${path}`]
      ?? routes[path]
      ?? routes[`${method} ${path.split('?')[0]}`]
      ?? routes[path.split('?')[0]];

    if (route === undefined) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `No stub for ${method} ${path}` } }),
        { status: 404, headers: { 'content-type': 'application/json' } }
      );
    }

    const value = typeof route === 'function' ? route() : route;

    if (value?.error) {
      return new Response(
        JSON.stringify({ success: false, error: value.error, requestId: 'test-request' }),
        { status: value.status ?? 400, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, data: value, requestId: 'test-request' }),
      { status: value?.status ?? 200, headers: { 'content-type': 'application/json' } }
    );
  };

  return { handler, calls };
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false }
    }
  });
}

export function renderWithProviders(ui, { path = '/today', queryClient = createTestQueryClient() } = {}) {
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Router initialPath={path}>{ui}</Router>
    </QueryClientProvider>
  );

  return { ...result, queryClient };
}

/** Standard authenticated status payload used by most page tests. */
export const AUTH_STATUS = {
  authEnabled: true,
  authConfigured: true,
  authenticated: true,
  owner: { email: 'owner@example.test', name: 'Owner' },
  writeOperationsEnabled: true,
  destructiveOperationsEnabled: false
};
