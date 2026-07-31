import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Minimal history-API router.
 *
 * Written in-repository rather than added as a dependency: the command center
 * needs path parameters, a `/documents/*` wildcard, and nothing else, and every
 * published react-router release currently carries open advisories that do not
 * apply to a client-only SPA but would still ship with the app.
 */

const RouterContext = createContext(null);

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) throw new Error('useRouter must be used inside a Router');
  return context;
}

export const useLocation = () => useRouter().location;
export const useNavigate = () => useRouter().navigate;

export function Router({ children, initialPath }) {
  const [location, setLocation] = useState(() => ({
    pathname: initialPath ?? window.location.pathname,
    search: initialPath ? '' : window.location.search
  }));

  useEffect(() => {
    const onPopState = () => {
      setLocation({ pathname: window.location.pathname, search: window.location.search });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const [pathname, search = ''] = String(to).split('?');
    const url = search ? `${pathname}?${search}` : pathname;
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    setLocation({ pathname, search: search ? `?${search}` : '' });
    try {
      window.scrollTo(0, 0);
    } catch {
      // Environments without a real layout engine do not implement scrolling.
    }
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

/**
 * Matches a route pattern against a pathname.
 * Supports `:param` segments and a trailing `*` wildcard.
 */
export function matchPath(pattern, pathname) {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = pathname.split('/').filter(Boolean);
  const params = {};

  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index];

    if (patternSegment === '*') {
      params['*'] = pathSegments.slice(index).map(decodeURIComponent).join('/');
      return params;
    }

    if (index >= pathSegments.length) return null;

    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = decodeURIComponent(pathSegments[index]);
      continue;
    }

    if (patternSegment !== pathSegments[index]) return null;
  }

  return patternSegments.length === pathSegments.length ? params : null;
}

/** Renders the first matching route. `routes` is an ordered array. */
export function Routes({ routes, fallback = null }) {
  const { location } = useRouter();

  for (const route of routes) {
    const params = matchPath(route.path, location.pathname);
    if (params) {
      const query = Object.fromEntries(new URLSearchParams(location.search));
      return <route.element params={params} query={query} />;
    }
  }

  return fallback;
}

export function Link({ to, children, className, onClick, ...rest }) {
  const navigate = useNavigate();

  // A caller-supplied handler runs first and is composed with navigation, so
  // passing `onClick` to a Link never silently disables the link.
  const handleClick = (event) => {
    onClick?.(event);
    // Let the browser handle modified clicks so "open in new tab" still works.
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };

  return (
    <a href={to} className={className} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}

export function NavLink({ to, children, end = false, ...rest }) {
  const location = useLocation();
  const isActive = end
    ? location.pathname === to
    : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <Link to={to} className={isActive ? 'nav-link is-active' : 'nav-link'} aria-current={isActive ? 'page' : undefined} {...rest}>
      {children}
    </Link>
  );
}
