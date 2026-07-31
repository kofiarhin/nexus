# Nexus Technical Specification

**Product direction:** Second brain and business operations command center  
**Status:** Target architecture approved; implementation remains milestone-based  
**Current audited application revision:** `cdb84e98fdf626340f1b2ecd04107f54eb817cf8`  
**Runtime:** Node.js 22+  
**Client:** React with Vite  
**Server:** Express with MVC-oriented boundaries  
**Canonical storage:** GitHub-hosted Markdown in `kofiarhin/nexus-vault`  
**Reasoning provider:** NVIDIA

## 1. System Context

Nexus provides one administrative and conversational interface over the Nexus Vault.

```text
User
  ↓
React/Vite client
  ↓
Express API
  ├─ Authentication and authorization
  ├─ Deterministic retrieval and search
  ├─ Domain services and validation
  ├─ Operation proposal and approval workflow
  ├─ Audit and revision management
  ├─ GitHub Vault integration
  └─ NVIDIA reasoning adapter
        ↓
Nexus Vault and Git history
```

The browser communicates only with the Express API. GitHub and NVIDIA credentials remain server-side.

NVIDIA is a reasoning dependency, not a persistence, retrieval, permission, validation, or mutation authority.

## 2. Current Implementation Baseline

At the audited revision, the implemented system includes:

- React/Vite client shell;
- Express API and MVC-oriented layers;
- environment validation, CORS, request IDs, standard envelopes, and safe error handling;
- read-only GitHub Vault access;
- deterministic structured and legacy project-registry parsing;
- health and project-listing routes;
- local evidence recording 49 passing tests, a passing lint check, a passing client build, and a local HTTP 200 project response.

No target capability described below is implemented merely because it appears in this specification. Production deployment and production verification remain unestablished unless separate evidence is recorded.

## 3. Architectural Principles

1. Markdown and Git history remain canonical.
2. Exact retrieval is deterministic and independent of AI.
3. Model output is untrusted until validated.
4. Reads, reasoning, proposals, approvals, mutations, verification, and completion are separate states.
5. Manual CRUD and conversational operations share the same domain services.
6. Every write uses revision-aware optimistic concurrency.
7. Important changes produce a reviewable diff before execution.
8. Every successful mutation is verified by readback and linked to Git evidence.
9. Long-term memory is explicit, reviewable, correctable, and removable.
10. The whole Vault is never loaded by default.

## 4. Repository Layout

The existing application layout remains valid:

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

Target server responsibilities should remain separated:

```text
server/
├── config/
├── controllers/
├── integrations/
│   ├── github/
│   └── nvidia/
├── middleware/
├── repositories/
├── routes/
├── services/
│   ├── retrieval/
│   ├── operations/
│   ├── memory/
│   ├── planning/
│   └── conversation/
├── schemas/
└── utils/
```

Controllers translate HTTP requests and responses. Services own business workflows. Repositories own Vault data access and parsing. Integrations own external API communication. Routes contain no business logic.

## 5. Client Architecture

The client is an authenticated administrative application with persistent navigation and an optional assistant panel.

### Primary routes

```text
/today
/chat
/businesses
/businesses/:businessId
/projects
/projects/:projectId
/tasks
/inbox
/documents
/documents/*
/knowledge
/memory
/daily
/reports
/activity
/settings
```

### Core page behavior

- **Today:** priorities, overdue work, deadlines, blockers, recommendations, and Ask Nexus.
- **Chat:** conversations, context scope, cited sources, and proposed actions.
- **Businesses:** operational overview, projects, tasks, metrics, risks, and reports.
- **Projects:** snapshot, state, focus, roadmap, tasks, decisions, documents, and activity.
- **Tasks:** list, board, today, upcoming, overdue, recurring, and completed views.
- **Inbox:** quick capture and review of unclassified information.
- **Documents:** file tree, Markdown editor, preview, metadata, history, and CRUD controls.
- **Knowledge:** durable reference notes and linked discovery.
- **Memory:** profile, preferences, goals, approved summaries, corrections, and removal.
- **Daily:** plans, notes, events, outcomes, and reflections.
- **Reports:** daily, weekly, business, project, and activity reports.
- **Activity:** proposals, approvals, mutations, commits, failures, and rollbacks.
- **Settings:** authentication, Vault, NVIDIA, approvals, permissions, and privacy.

The client must show loading, empty, permission, conflict, validation, upstream, and retry states distinctly.

## 6. Environment

```env
NODE_ENV=development
PORT=5000
CLIENT_URL=http://localhost:5173
VITE_API_BASE_URL=http://localhost:5000/api/v1

GITHUB_TOKEN=
GITHUB_OWNER=kofiarhin
GITHUB_VAULT_REPO=nexus-vault
GITHUB_VAULT_BRANCH=main

AI_PROVIDER=nvidia
NVIDIA_API_KEY=
NVIDIA_MODEL=

AUTH_ENABLED=true
SESSION_SECRET=
WRITE_OPERATIONS_ENABLED=false
DESTRUCTIVE_OPERATIONS_ENABLED=false
```

Only `VITE_` variables may be exposed to the client. Secrets must never be returned, logged, committed, or included in model context.

Write and destructive operations default to disabled unless authentication and required controls are configured.

## 7. Standard Response Contract

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
    "message": "Safe message",
    "details": {}
  },
  "requestId": "uuid"
}
```

`details` is optional and must contain only safe, structured validation or conflict information.

Every response includes `x-request-id`. A supplied valid request ID is preserved; otherwise the server generates one.

## 8. Authentication And Authorization

Authentication is mandatory before mutation APIs are enabled in any reachable environment.

The initial authorization model is owner-only:

- authenticated owner may read permitted Vault paths;
- authenticated owner may create operation proposals;
- material and destructive writes require explicit approval;
- unauthenticated requests cannot read private operational content or perform mutations.

Future multi-user roles require a separate approved permission model.

Server-side authorization must evaluate the authenticated principal, action, path, entity type, feature flags, and destructive-operation policy. NVIDIA cannot grant authority.

## 9. Vault Repository Interface

All Vault implementations expose a common repository contract.

```text
readText(path, ref?)
readMetadata(path, ref?)
listDirectory(path, ref?)
searchText(query, scope, ref?)
createText(path, content, message)
replaceText(path, content, expectedSha, message)
appendText(path, content, expectedSha, message)
movePath(from, to, expectedSha, message)
archivePath(path, expectedSha, message)
deletePath(path, expectedSha, message)
readHistory(path)
restoreRevision(path, revision, expectedSha, message)
```

Each read returns the path, content or metadata, revision/blob SHA, and source repository information.

Each mutation must use the current expected revision. A mismatch returns a conflict rather than overwriting newer content.

## 10. Deterministic Retrieval

Retrieval follows the Vault's operating contracts:

1. resolve the user-selected scope;
2. read `NEXUS.md` when workspace rules are required;
3. read relevant identity indexes only when personal context is necessary;
4. use registries for deterministic discovery;
5. open the selected business, project, task, or document entrypoint;
6. load only relevant records;
7. invoke NVIDIA only for reasoning or generation.

Retrieval responses include a context manifest:

```json
{
  "sources": [
    {
      "path": "projects/nexus/PROJECT.md",
      "sha": "blob-sha",
      "title": "Nexus",
      "reason": "Current project state"
    }
  ]
}
```

Exact listing and document lookup never require AI.

## 11. Search

Search is layered:

1. registry and exact-path resolution;
2. metadata filters;
3. bounded repository-native text search;
4. optional derived index only after repository-native retrieval proves insufficient.

Search returns ranked source records before any AI synthesis. The first functional release does not require a vector database.

## 12. NVIDIA Reasoning Adapter

The NVIDIA adapter is server-side and replaceable behind a provider interface.

```text
generateAnswer(messages, contextManifest, options)
generatePlan(goal, contextManifest, options)
generateSummary(content, contextManifest, options)
proposeOperations(instruction, contextManifest, allowedOperations)
```

The adapter receives only bounded context and safe metadata. It must not receive GitHub credentials, session secrets, authorization headers, or unrelated Vault content.

The model may return:

- a conversational answer;
- a plan or report;
- citations mapped to supplied source identifiers;
- structured operation proposals.

The model may not directly call GitHub or mark an operation approved, executed, verified, or completed.

Streaming responses may use Server-Sent Events. The final response must retain the source manifest and operation proposal identifiers.

## 13. Conversation Model

A conversation contains:

```json
{
  "id": "conversation-id",
  "title": "Daily planning",
  "scope": {
    "type": "vault|business|project|document|custom",
    "ids": []
  },
  "messages": [],
  "sourceManifest": [],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Conversation transcripts are working context and are not automatically canonical long-term memory.

At appropriate points, Nexus may propose a memory summary containing:

- the proposed durable statement;
- classification such as fact, preference, decision, goal, or lesson;
- source conversation and supporting Vault paths;
- target path;
- confidence and unresolved conflict warnings.

The user may approve, edit, reject, forget, or correct the memory proposal.

## 14. Operation Proposal Contract

Natural-language and manual mutation requests normalize into an operation proposal.

```json
{
  "id": "operation-id",
  "action": "create|replace|patch|append|move|archive|delete|restore",
  "path": "projects/nexus/TASKS.md",
  "destinationPath": null,
  "expectedSha": "current-blob-sha",
  "reason": "Add approved task",
  "before": "current content",
  "after": "proposed content",
  "diff": "unified diff",
  "risk": "low|material|destructive",
  "sources": [],
  "status": "proposed"
}
```

Statuses:

```text
proposed
approved
rejected
executing
succeeded
conflicted
failed
rolled-back
```

An operation proposal is not execution evidence.

## 15. Mutation Pipeline

Every mutation follows this sequence:

1. authenticate the user;
2. authorize the action and path;
3. resolve the canonical target;
4. read the current content and revision;
5. validate the requested entity and schema;
6. calculate the proposed content and diff;
7. classify risk;
8. require approval when policy demands it;
9. re-read the target immediately before writing;
10. apply with the expected revision;
11. confirm the GitHub response;
12. verify by readback;
13. record the commit and audit event;
14. return the verified result.

Create operations must reject existing paths unless an explicit replace operation is authorized.

Append operations must define an exact insertion target or append contract. They must not duplicate content after retries.

Move operations must validate both source and destination and update affected registries or links where required.

Archive is the default removal behavior. Hard delete requires explicit destructive confirmation and feature enablement.

## 16. Idempotency And Concurrency

Mutation requests include an idempotency key. Repeated requests with the same key and payload return the original result rather than creating duplicate writes.

Writes use optimistic concurrency through blob SHA or equivalent revision identifiers.

Conflict responses include:

- expected revision;
- current revision;
- affected path;
- safe guidance to reload, compare, and repropose.

The server never force-overwrites a conflict automatically.

## 17. Domain Records

The Vault remains Markdown-first. Operational entities may use validated front matter or stable registry tables while preserving human-readable bodies.

### Task fields

```text
id
name
status
priority
dueDate
businessId
projectId
owner
recurrence
dependencies
blockers
createdAt
updatedAt
sourcePaths
```

Task status and priority vocabularies must be explicit and validated. AI recommendations cannot silently change authoritative task state.

### Business fields

```text
id
name
status
purpose
goals
projects
metrics
risks
updatedAt
```

### Project fields

```text
id
name
lifecycle
currentState
currentFocus
roadmap
tasks
decisions
assumptions
openQuestions
updatedAt
```

Existing Vault contracts remain supported during migration. Schema changes require backward-compatible parsing or an approved migration.

## 18. API Surface

The following routes define the target API. Implementation remains milestone-based.

### Health

- `GET /api/v1/health`
- `GET /api/v1/health/vault`
- `GET /api/v1/health/ai`

### Projects And businesses

- `GET /api/v1/projects`
- `GET /api/v1/projects/:projectId`
- `GET /api/v1/businesses`
- `GET /api/v1/businesses/:businessId`

### Tasks And planning

- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId`
- `DELETE /api/v1/tasks/:taskId`
- `GET /api/v1/tasks/today`
- `GET /api/v1/planning/today`
- `POST /api/v1/planning/today/proposals`

### Vault And documents

- `GET /api/v1/vault/tree`
- `GET /api/v1/vault/files`
- `POST /api/v1/vault/files`
- `PUT /api/v1/vault/files`
- `POST /api/v1/vault/files/append`
- `POST /api/v1/vault/files/move`
- `POST /api/v1/vault/files/archive`
- `DELETE /api/v1/vault/files`
- `GET /api/v1/vault/files/history`
- `POST /api/v1/vault/files/restore`
- `GET /api/v1/search`

### Conversation And memory

- `POST /api/v1/conversations`
- `GET /api/v1/conversations/:conversationId`
- `POST /api/v1/conversations/:conversationId/messages`
- `POST /api/v1/memory/proposals`
- `GET /api/v1/memory`
- `PATCH /api/v1/memory/:memoryId`
- `DELETE /api/v1/memory/:memoryId`

### Operations And audit

- `POST /api/v1/operations/proposals`
- `GET /api/v1/operations/:operationId`
- `POST /api/v1/operations/:operationId/approve`
- `POST /api/v1/operations/:operationId/reject`
- `POST /api/v1/operations/:operationId/execute`
- `GET /api/v1/activity`

Approval and execution may be combined for low-risk manual operations only when policy explicitly allows it. Material and destructive operations remain separate.

## 19. Error Codes

Expected codes include:

```text
AUTH_REQUIRED
FORBIDDEN
VALIDATION_ERROR
PATH_NOT_ALLOWED
OPERATION_NOT_ALLOWED
APPROVAL_REQUIRED
DESTRUCTIVE_CONFIRMATION_REQUIRED
IDEMPOTENCY_CONFLICT
VAULT_NOT_CONFIGURED
VAULT_FILE_NOT_FOUND
VAULT_CONFLICT
VAULT_UPSTREAM_ERROR
AI_NOT_CONFIGURED
AI_UPSTREAM_ERROR
CONTEXT_LIMIT_EXCEEDED
NOT_FOUND
INTERNAL_ERROR
```

Errors expose safe messages and structured details without upstream secrets or raw sensitive payloads.

## 20. Audit Model

Every proposal and mutation records:

- request ID;
- authenticated actor;
- operation ID;
- action and risk level;
- source and destination paths;
- before and after revisions;
- approval evidence;
- Git commit SHA;
- timestamps;
- execution and readback result;
- rollback relationship when applicable.

Audit records do not replace Git or canonical Vault content. They provide operational traceability.

## 21. Security Controls

- The Vault must be private before confidential content is stored.
- GitHub tokens use the minimum repository permissions required.
- NVIDIA credentials remain server-side.
- Session cookies use secure production settings.
- State-changing requests use CSRF or equivalent same-origin protection.
- Routes use rate limits and payload-size limits.
- Paths are normalized and restricted to allowlisted Vault areas.
- Markdown rendering sanitizes unsafe HTML and links.
- Model prompts and logs redact sensitive values.
- Model-generated paths, actions, and content are validated deterministically.
- Destructive operations are disabled by default.

## 22. Testing Requirements

### Unit tests

- registry and Markdown parsers;
- path normalization and allowlists;
- entity schemas;
- task filtering and Today selection;
- context selection and citation mapping;
- diff generation;
- approval and risk policies;
- conflict and idempotency handling;
- memory proposal classification.

### Integration tests

- authenticated read and mutation routes;
- GitHub read, create, replace, append, archive, delete, and restore adapters with mocks;
- NVIDIA adapter with deterministic fixtures;
- proposal-to-approval-to-readback workflow;
- manual and conversational operations sharing the same service layer;
- safe error normalization.

### End-to-end tests

- browse and edit a Markdown document;
- create and complete a task;
- generate a Today recommendation with citations;
- propose a conversational update, inspect the diff, approve it, and confirm Git evidence;
- reject an operation without changing the Vault;
- detect a revision conflict;
- correct or delete a memory record;
- restore an archived or previous revision.

Authored tests are not verification until executed against the recorded revision and environment.

## 23. Observability

The server records safe structured events for:

- request lifecycle and latency;
- retrieval sources and counts, excluding sensitive content;
- NVIDIA request outcome and token or size metadata where safely available;
- proposal, approval, execution, conflict, and rollback transitions;
- GitHub upstream outcomes;
- validation and authorization failures.

Logs must not contain credentials, full private documents, raw prompts containing sensitive content, or session values.

## 24. Deployment

The target deployment preserves the existing split:

- client deployable as a static Vite build;
- Express API deployable as a Node service;
- GitHub as initial Vault persistence;
- NVIDIA accessed only from the server.

Production readiness requires:

- private Vault configuration;
- authentication and secure sessions;
- protected secrets;
- HTTPS;
- CORS and origin restrictions;
- write and destructive feature flags;
- CI checks;
- backup and rollback procedures;
- deployment and post-deployment verification evidence.

## 25. Delivery Milestones

### Milestone A — Verified read workspace

- project details;
- Markdown browsing;
- bounded search;
- source manifests;
- improved client navigation.

### Milestone B — Operational core

- validated task records;
- Today dashboard;
- inbox and daily notes;
- business and project views;
- deterministic reports.

### Milestone C — Controlled CRUD

- owner authentication;
- private Vault readiness;
- manual CRUD;
- revision conflicts;
- diff preview and approvals;
- Git audit and rollback.

### Milestone D — NVIDIA conversation and memory

- scoped conversation;
- cited answers;
- planning and prioritization;
- structured operation proposals;
- approved memory summaries.

### Milestone E — Command-center expansion

- recurring workflows;
- richer business metrics and reporting;
- broader knowledge and relationship context;
- derived search indexes only when justified.

## 26. Definition Of Done For Each Capability

A capability is done only when:

- scope and acceptance criteria are approved;
- implementation is committed at a known revision;
- required automated checks pass;
- security and conflict behavior are verified;
- client and API behavior are exercised together where applicable;
- successful mutations are confirmed by Vault readback and Git evidence;
- deployment is separately verified when claimed;
- documentation distinguishes remaining limitations.

Implementation, merge, deployment, and completion remain separate states.