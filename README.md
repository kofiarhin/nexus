# Nexus

Nexus is an AI-native productivity and knowledge operating system. Canonical knowledge lives as
Markdown in a GitHub-hosted Vault; deterministic retrieval stays separate from AI reasoning.

This repository implements the Foundation MVP described in [docs/SPECIFICATION.md](docs/SPECIFICATION.md).
The scope is read-only: the API lists projects from the Vault and reports health. Authentication,
write operations, and AI requests are deferred to later milestones.

## Requirements

- Node.js 22.12 or newer
- npm with access to the public npm registry

## Setup

```bash
npm ci
cp .env.example .env
```

Use `npm install` only when intentionally changing dependencies and regenerating `package-lock.json`.
Populate `GITHUB_TOKEN` and `GITHUB_OWNER` to connect a Vault. Without them the API still runs and
returns a controlled `VAULT_NOT_CONFIGURED` response from Vault-backed routes.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite client and the Express API together |
| `npm run dev:client` | Run the client only, on port 5173 |
| `npm run dev:server` | Run the API only, with file watching |
| `npm run build` | Build the client to `dist/client` |
| `npm run build:client` | Build the client to `dist/client` |
| `npm start` | Start the API for production |
| `npm test` | Run the Vitest suite |
| `npm run lint` | Syntax-check server, test, and script files |

## Architecture

The browser talks only to the Express API. GitHub and NVIDIA credentials never reach the client;
only `VITE_`-prefixed variables are exposed to the bundle.

```text
client/   Vite + React dashboard
server/
  routes/         versioned HTTP paths
  controllers/    HTTP translation
  services/       business operations
  repositories/   Vault reads and Markdown parsing
  integrations/   GitHub contents API client
  middleware/     request IDs, not-found, error handling
  config/         environment validation
tests/    Vitest unit and integration tests
```

Controllers do not call GitHub directly, and routes contain no business logic.

## API

All routes are served under `/api/v1`.

| Route | Description |
| --- | --- |
| `GET /health` | Confirms the service is responding |
| `GET /health/vault` | Reports whether Vault configuration is present, plus repository and branch |
| `GET /projects` | Lists projects parsed from `registry/PROJECTS.md` |

`GET /health/vault` reports configuration only; it does not probe remote connectivity.

Successful responses use `{ "success": true, "data": {}, "requestId": "uuid" }`. Failures use
`{ "success": false, "error": { "code": "...", "message": "..." }, "requestId": "uuid" }`. Every
response carries an `x-request-id` header, preserving a supplied ID when one is sent.

Expected Vault failures are normalized as:

- `VAULT_NOT_CONFIGURED` with HTTP 503
- `VAULT_FILE_NOT_FOUND` with HTTP 404
- `VAULT_UPSTREAM_ERROR` with HTTP 502
- malformed JSON request bodies as `INVALID_JSON` with HTTP 400

## Vault format

`GET /projects` parses Markdown table rows whose first cell is a project link:

```md
| [Project Name](projects/project-name.md) | Summary |
```

Rows without a link in the first cell are ignored, and registry order is preserved.

## Verification

Run the complete Foundation verification suite from the repository root:

```bash
npm ci
npm test
npm run lint
npm run build:client
```

Start the API with `npm start`, then smoke-test:

```text
GET /api/v1/health
GET /api/v1/health/vault
GET /api/v1/projects
GET /api/v1/unknown
```

## Deployment

Heroku starts the API with `npm start` via the `Procfile`, listening on `process.env.PORT`.
Vercel builds the client with `npm run build:client` and serves `dist/client`. Live deployment is
outside the Foundation MVP.
