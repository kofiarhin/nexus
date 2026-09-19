# Nexus

Nexus is a second brain and business operations command center. Canonical knowledge lives as Markdown
in a GitHub-hosted Vault; deterministic retrieval, validation, path policy, and CRUD stay separate from
AI reasoning. NVIDIA provides conversation, synthesis, planning, and operation proposals over
deliberately selected Vault context.

Product direction is in [docs/PRD.md](docs/PRD.md); the technical target is in
[docs/SPECIFICATION.md](docs/SPECIFICATION.md). Implementation notes and known gaps for this build are
in [docs/IMPLEMENTATION-NOTES.md](docs/IMPLEMENTATION-NOTES.md).

## Security first

**The Vault repository must be private before you store personal, client, financial, or operational
records in it.** Nexus reads and writes whatever the configured token can reach; it cannot make a
public repository safe.

- Never commit `.env`, tokens, passwords, or Vault content.
- GitHub and NVIDIA credentials stay server-side. Only `VITE_`-prefixed variables reach the browser.
- All MVP API endpoints are public. Do not expose the API beyond trusted local/private networks.
- Writes are disabled by default and stay disabled until `WRITE_OPERATIONS_ENABLED=true`.
- Hard delete is disabled by default; archive is the default removal method.

## Requirements

- Node.js 22.12 or newer
- npm with access to the public npm registry

## Setup

```bash
npm ci
cp .env.example .env
```

Use `npm install` only when intentionally changing dependencies and regenerating `package-lock.json`.

### 1. Connect the Vault

Set `GITHUB_OWNER` and `GITHUB_TOKEN`. Use a fine-grained personal access token scoped to the Vault
repository only:

| Capability | Required permission |
| --- | --- |
| Reading projects, tasks, documents, search, history | Contents: **Read** |
| Creating, replacing, appending, moving, archiving, restoring | Contents: **Read and write** |
| Hard delete | Contents: **Read and write** |

No other repository permission is needed. Without a token the API still runs and returns a controlled
`VAULT_NOT_CONFIGURED` response from Vault-backed routes.

### 2. Enable writes when you are ready

```env
WRITE_OPERATIONS_ENABLED=true
DESTRUCTIVE_OPERATIONS_ENABLED=false
```

Writes activate when `WRITE_OPERATIONS_ENABLED` is true. `GET /api/v1/settings` reports exactly why writes are on or off.

### 3. Bootstrap a Vault (optional)

```bash
npm run vault:bootstrap ./vault-bootstrap
```

Writes starter Markdown to a local directory without touching GitHub and without overwriting existing
files. Review the output, then commit it to your private Vault repository yourself.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite client and the Express API together |
| `npm run dev:client` | Run the client only, on port 5173 |
| `npm run dev:server` | Run the API only, with file watching |
| `npm run build` / `npm run build:client` | Build the client to `dist/client` |
| `npm start` | Start the API for production |
| `npm test` | Run the Vitest suite |
| `npm run test:watch` | Run the suite in watch mode |
| `npm run lint` | Syntax-check server, client, test, and script files |
| `npm run verify` | Lint, test, and build in one command |
| `npm run vault:bootstrap` | Write starter Vault documents locally |

## Architecture

The browser talks only to the Express API. GitHub and NVIDIA credentials never reach the client.

```text
client/
  lib/          router, API client, TanStack Query hooks, safe Markdown renderer
  components/   layout, primitives, view states, operation review
  pages/        one module per primary route
server/
  routes/       versioned HTTP paths and validation binding
  controllers/  HTTP translation only
  services/     operations, planning, conversation, memory, retrieval, reports
  repositories/ Vault access and Markdown parsing
  integrations/ GitHub Contents API, NVIDIA reasoning adapter
  middleware/   request IDs, rate limits, validation, errors
  schemas/      validation for all external and model-generated input
  stores/       process-scoped operation, audit, and conversation records
  config/       environment validation and the operation policy
tests/          unit, integration, and component tests
```

Routes contain no business logic. Manual administration and conversational operations call the same
services, so validation, diffs, approval, concurrency, and audit behave identically.

### What NVIDIA does and does not do

NVIDIA handles conversation, intent interpretation, summarisation, planning, report narratives, and
structured operation proposals. It never performs access control, exact retrieval, validation, GitHub writes, conflict detection, approval, or completion. Model output is untrusted input: every proposed operation is schema-validated and path-checked server-side.

## API

All routes are served under `/api/v1`. Responses use
`{ "success": true, "data": {}, "requestId": "uuid" }` or
`{ "success": false, "error": { "code": "...", "message": "...", "details": {} }, "requestId": "uuid" }`.
Every response carries `x-request-id`, preserving a supplied ID.

All endpoints are public for the MVP. Mutating requests accept an optional `idempotency-key` header.

### Health

| Route | Description |
| --- | --- |
| `GET /health` | Service liveness |
| `GET /health/vault` | Vault configuration and write flags (no connectivity probe) |
| `GET /health/ai` | Reasoning provider configuration |

### Workspace

| Route | Description |
| --- | --- |
| `GET /projects`, `GET /projects/:projectId` | Registry list and full project record |
| `GET /businesses`, `GET /businesses/:businessId` | Registry list and full business record |
| `GET /tasks`, `GET /tasks/today`, `GET /tasks/summary`, `GET /tasks/:taskId` | Task queries |
| `POST /tasks`, `PATCH /tasks/:taskId`, `DELETE /tasks/:taskId` | Task CRUD |
| `GET /planning/today` | Deterministic daily plan with reasons and sources |
| `POST /planning/today/proposals` | Adds an AI narrative on top of that plan |
| `GET /inbox`, `POST /inbox`, `GET /inbox/:entryId/suggestion`, `POST /inbox/:entryId/promote`, `DELETE /inbox/:entryId` | Capture |
| `GET /daily`, `GET /daily/:date`, `POST /daily/:date/entries` | Daily notes |
| `GET /knowledge`, `GET /knowledge/note?path=` | Knowledge notes with backlinks |
| `GET /reports?type=` | Daily, weekly, project, business, activity reports |
| `GET /settings` | Configuration state; never secret values |

### Vault and documents

| Route | Description |
| --- | --- |
| `GET /vault/tree`, `GET /vault/files?path=`, `GET /vault/files/history?path=` | Deterministic reads |
| `POST /vault/files` | Create (refuses an existing path) |
| `PUT /vault/files` | Replace |
| `POST /vault/files/append` | Append (retry-safe; identical content is a no-op) |
| `POST /vault/files/move` | Move or rename |
| `POST /vault/files/archive` | Archive to `archive/<path>.<date>.md` |
| `DELETE /vault/files` | Propose a hard delete |
| `POST /vault/files/restore` | Restore a previous revision |
| `GET /search?q=` | Layered search: exact path, registry, bounded text |

### Conversation, memory, operations, activity

| Route | Description |
| --- | --- |
| `POST /conversations`, `GET /conversations`, `GET /conversations/:id`, `DELETE /conversations/:id` | Scoped conversations |
| `POST /conversations/:id/messages` | Cited answer; `stream: true` returns Server-Sent Events; `allowOperations: true` returns proposals |
| `GET /memory`, `POST /memory/proposals`, `POST /memory/proposals/:id/approve`, `POST /memory/proposals/:id/reject` | Memory review |
| `PATCH /memory/:memoryId`, `DELETE /memory/:memoryId` | Correct or forget a memory |
| `GET /operations`, `POST /operations/proposals`, `GET /operations/:id` | Operation proposals |
| `POST /operations/:id/approve`, `/reject`, `/execute` | Approval lifecycle |
| `GET /activity` | Audit events with revisions, commits, and approval evidence |

### Error codes

```text
FORBIDDEN  VALIDATION_ERROR  INVALID_JSON  PATH_NOT_ALLOWED  OPERATION_NOT_ALLOWED`r`nAPPROVAL_REQUIRED  DESTRUCTIVE_CONFIRMATION_REQUIRED  IDEMPOTENCY_CONFLICT`r`nRATE_LIMITED
VAULT_NOT_CONFIGURED  VAULT_FILE_NOT_FOUND  VAULT_FILE_EXISTS  VAULT_CONFLICT
VAULT_UPSTREAM_ERROR  VAULT_WRITE_DISABLED
AI_NOT_CONFIGURED  AI_UPSTREAM_ERROR  AI_TIMEOUT  CONTEXT_LIMIT_EXCEEDED
NOT_FOUND  CONFLICT  INTERNAL_ERROR
```

## Mutation pipeline

Every write, manual or conversational, follows the same sequence: check the action and path policy, read the current revision, validate, compute the before/after diff, classify risk, require approval where policy demands it, re-read immediately before writing, apply with optimistic concurrency, verify by readback, record the Git commit, and write an audit event.

Risk classification is deterministic and server-side:

| Risk | Applies to | Approval |
| --- | --- | --- |
| `low` | Create, append, replace under `inbox/`, `daily/`, `tasks/`, and any `TASKS.md` | May combine approval and execution when `AUTO_APPROVE_LOW_RISK` is true |
| `material` | Everything else, plus every move and archive | Approval and execution are separate steps |
| `destructive` | Hard delete | Separate approval **and** explicit `confirmDestructive` |

A conflict returns the expected revision, the current revision, the path, and guidance to reload,
compare, and repropose. The server never force-overwrites.

## Vault format

Existing Vault structures keep working; nothing here requires a migration.

**Project registry** (`registry/PROJECTS.md`) — both layouts are parsed, and may be interleaved:

```md
| ID | Name | Status | Path | Updated |
| --- | --- | --- | --- | --- |
| nexus | Nexus | active | projects/nexus/PROJECT.md | 2026-07-31 |

| [Alpha](projects/alpha.md) | Legacy linked row |
```

**Business registry** (`registry/BUSINESSES.md`) uses the same two layouts. Project and business
documents may carry optional front matter and are read through `##` sections such as
`Current state`, `Current focus`, `Roadmap`, `Decisions`, `Assumptions`, `Open questions`, `Purpose`,
`Goals`, `Metrics`, and `Risks`.

**Tasks** are annotated Markdown checklist items in `tasks/TASKS.md` and any `projects/<id>/TASKS.md`.
Every annotation is optional — a plain `- [ ] Do the thing` parses fine and receives a stable derived
id:

```md
- [ ] Review the quarterly plan @id(tsk-1) @priority(high) @due(2026-08-04) @project(nexus) @owner(kofi)
- [x] Ship the foundation @id(tsk-0) @completed(2026-07-30)
```

Supported keys: `id`, `status`, `priority`, `due`, `project`, `business`, `owner`, `recurrence`,
`depends`, `blocked`, `created`, `updated`, `completed`. The checkbox is authoritative for completion.

**Memory** (`memory/MEMORY.md`) and **inbox** (`inbox/INBOX.md`) use the same annotation syntax on
plain bullets. **Daily notes** are `daily/YYYY-MM-DD.md`. **Knowledge** notes are any Markdown under
`knowledge/`.

## Verification

```bash
npm ci
npm test
npm run lint
npm run build:client
```

Then start the API with `npm start` and the client with `npm run dev:client`, and smoke-test `GET /api/v1/health`, project and task retrieval, the Vault tree, a document read, a write flow, a
conflict, an approval, and the activity history.

Tests never use real GitHub or NVIDIA credentials: both are driven by in-memory fixtures.

## Deployment

Heroku starts the API with `npm start` via the `Procfile`, listening on `process.env.PORT`. Vercel
builds the client with `npm run build:client` and serves `dist/client`.

Production readiness additionally requires authentication, HTTPS, a private Vault, a `CLIENT_URL` matching the deployed origin, and verified backup and rollback procedures. No production deployment is established by this repository.

## Known limitations

- Operations, audit events, conversations, and idempotency keys are held in memory per process. They
  are operational traceability, not canonical records; a restart clears them. Git history and Vault
  Markdown remain the durable record.
- Search reads a bounded number of Markdown files per query (`SEARCH_MAX_FILES`). Very large Vaults may
  need a derived index, which the current specification does not require.
- Move is create-then-delete because the GitHub Contents API has no atomic rename. The destination is
  written first, so a failure never loses the source.
- Authentication and user authorization are not implemented in this MVP. Every endpoint is public to anyone who can reach the API.
- Live NVIDIA calls, production GitHub writes, and deployment are unverified in this repository.
