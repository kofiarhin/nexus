# Project Summary

## Last Task

Removed MVP authentication from Nexus so every API endpoint is public.

## Progress

- Removed auth routes, services, middleware, login UI, CSRF/session handling, owner credential env setup, and password hashing script.
- Writes now depend on operation flags and existing path/policy safeguards instead of owner credentials.
- Updated docs and tests for the public MVP API contract.

## Files

- `server/app.js`
- `server/routes/index.js`
- `server/config/env.js`
- `client/App.jsx`
- `client/lib/api.js`
- `client/pages/Settings.jsx`
- `tests/integration/publicAccess.test.js`
- `README.md`
