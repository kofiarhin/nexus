# Nexus Technical Specification

**Status:** Foundation MVP approved  
**Runtime:** Node.js 22+  
**Client:** React with Vite  
**Server:** Express using MVC boundaries  
**Storage:** GitHub-hosted Markdown Vault

## 1. System Context

The React client communicates only with the Express API. The API communicates with GitHub and, in later milestones, NVIDIA. The browser must never receive GitHub or AI credentials.

## 2. Repository Layout

```text
nexus/
├── package.json
├── package-lock.json
├── .env.example
├── Procfile
├── README.md
├── client/
├── server/
├── tests/
├── scripts/
└── docs/
```

The client and server live directly below the repository root. There is no top-level `src/` directory. Root npm scripts control development, build, preview, start, test, and syntax checks.

## 3. Client

The client is a Vite application rooted at `client/`. It reads `VITE_API_BASE_URL` and calls versioned backend routes. The Foundation MVP renders a project dashboard, loading state, empty state, and configuration-error state.

The production build is emitted to `dist/client` for Vercel-compatible static deployment.

## 4. Server Architecture

- **Routes** define versioned HTTP paths.
- **Controllers** translate HTTP requests and responses.
- **Services** contain business operations.
- **Repositories** retrieve and parse Vault data.
- **Integrations** communicate with GitHub.
- **Middleware** handles request IDs, CORS, JSON parsing, not-found responses, and errors.
- **Config** validates environment values.

Controllers must not call GitHub directly. Routes must not contain business logic.

## 5. Environment

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:5173
VITE_API_BASE_URL=http://localhost:5000/api/v1
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_VAULT_REPO=nexus-vault
GITHUB_VAULT_BRANCH=main
AI_PROVIDER=nvidia
NVIDIA_API_KEY=
NVIDIA_MODEL=
```

Only `VITE_` variables may be exposed to the client. GitHub and NVIDIA credentials remain server-side.

## 6. Response Contract

Success:

```json
{
  "success": true,
  "data": {},
  "requestId": "uuid"
}
```

Failure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Safe message"
  },
  "requestId": "uuid"
}
```

Every request receives an `x-request-id` response header. A supplied request ID is preserved; otherwise the server generates one.

## 7. GitHub Vault Integration

The GitHub client uses the repository contents API and a server-side bearer token. Foundation MVP operations are read-only.

`readText(path)` must:

1. Reject missing configuration with `VAULT_NOT_CONFIGURED` and HTTP 503.
2. Request the configured branch explicitly.
3. Return decoded UTF-8 Markdown.
4. Convert missing files to `VAULT_FILE_NOT_FOUND` and HTTP 404.
5. Convert other upstream failures to `VAULT_UPSTREAM_ERROR` and HTTP 502.
6. Never return the token or raw authorization headers.

## 8. Project Retrieval

`GET /api/v1/projects` reads `registry/PROJECTS.md`. The repository parses Markdown table rows whose first cell is a project link such as:

```md
| [Project Name](projects/project-name.md) | Summary |
```

It returns:

```json
{
  "projects": [
    {
      "name": "Project Name",
      "slug": "project-name",
      "path": "projects/project-name.md",
      "summary": "Summary"
    }
  ]
}
```

This route must not invoke AI.

## 9. Health Routes

- `GET /api/v1/health` confirms the Express service is responding.
- `GET /api/v1/health/vault` reports whether Vault configuration is present and identifies the configured repository and branch without exposing credentials.

The Vault health route does not claim remote connectivity unless an explicit remote probe is added later.

## 10. Error Handling

Unknown routes return `NOT_FOUND`. Unhandled server errors return `INTERNAL_ERROR` with a generic message. Expected operational errors retain their safe code and message.

## 11. Testing

Initial tests cover:

- default environment configuration;
- invalid ports;
- API health and request IDs;
- deterministic Markdown project parsing;
- successful project listing with a mocked GitHub response;
- controlled behavior when Vault credentials are absent.

## 12. Deployment

Heroku starts the API with `npm start` through the `Procfile`. The server listens on `process.env.PORT`.

Vercel builds the client through `npm run build:client` and serves `dist/client`. Deployment configuration and live deployment are outside this milestone.

## 13. Deferred Work

Authentication, write operations, optimistic concurrency, Markdown editing, project creation, search indexing, daily capture, planning, intent classification, NVIDIA requests, streaming chat, CI/CD, deployment, migration, and production verification require later approved milestones.

## 14. Definition of Done for Foundation MVP

- Approved files exist on an isolated branch.
- The API boundaries and read-only Vault integration match this specification.
- Tests are authored for the initial routes and parser.
- Dependency installation, test execution, syntax checks, and client build are attempted and their actual evidence is reported.
- A draft pull request targets `main`.
- Nothing is merged or deployed without separate authority.
