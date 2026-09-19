# Nexus Product Requirements Document

**Product:** Nexus  
**Product direction:** Second brain and business operations command center  
**Status:** Target direction approved; implementation remains milestone-based  
**Application repository:** `kofiarhin/nexus`  
**Knowledge repository:** `kofiarhin/nexus-vault`

## Executive Summary

Nexus is Kofi's personal second brain and business operations command center. It provides one secure interface for understanding long-term context, managing businesses and projects, planning daily work, operating on Markdown records, and conversing with an AI assistant grounded in the Nexus Vault.

The Nexus Vault remains the durable source of truth. Git history provides revision evidence and rollback. Deterministic services handle exact retrieval, validation, permissions, and CRUD operations. NVIDIA provides reasoning, synthesis, planning, and natural-language interpretation over deliberately selected Vault context.

Nexus must support both conversational operation and complete administrative control through the frontend. Anything the assistant can propose must also be visible and manageable manually.

## Product Vision

Nexus should help Kofi answer and act on questions such as:

- What should I work on today?
- Which business or project needs attention?
- What is overdue, blocked, or waiting for a decision?
- What did I previously decide about this topic?
- Create, update, append, archive, or delete this Vault record.
- Summarize what changed this week and prepare the next plan.

The product combines:

```text
Nexus Vault = long-term memory
Conversation = working context
Deterministic retrieval = remembering exact information
NVIDIA = reasoning and synthesis
CRUD services = taking controlled action
Frontend = visibility and administration
Git = audit history and rollback
```

## Initial User

The initial product is an owner-operated system for Kofi. Multi-user teams, external customer accounts, and delegated business roles require later authorization and permission design.

## Product Principles

1. Markdown in the Nexus Vault is canonical and remains useful without the application.
2. Deterministic retrieval happens before AI reasoning.
3. NVIDIA reasons over selected context; it is not the database, permission system, or GitHub client.
4. Facts, ideas, assumptions, decisions, tasks, implementation, verification, and completion remain distinct.
5. Important AI-proposed mutations require a diff preview and explicit approval.
6. Manual frontend CRUD and conversational operations use the same validated backend services.
7. Every mutation is attributable, revision-aware, auditable, and reversible.
8. The browser never receives GitHub or NVIDIA credentials.
9. Private or sensitive information must not be stored in a public Vault.
10. Nexus must not silently invent or permanently store inferred personal facts.

## Current Implementation Baseline

At audited application revision `cdb84e98fdf626340f1b2ecd04107f54eb817cf8`, the implemented Foundation includes:

- React/Vite client shell;
- Express API with MVC-oriented boundaries;
- environment validation, request IDs, CORS, safe errors, and standard response envelopes;
- read-only GitHub Vault access;
- deterministic parsing of structured and legacy project registries;
- `GET /api/v1/health`;
- `GET /api/v1/health/vault`;
- `GET /api/v1/projects`.

Local evidence recorded for that revision reports 49 passing tests, a passing repository lint check, a passing client build, and a live local projects endpoint returning HTTP 200. No production deployment or production-runtime verification is established by this document.

The capabilities below define the target product and future milestones. They must not be described as implemented until supported by repository and runtime evidence.

## Core Product Areas

### 1. Today

The default command-center dashboard presents:

- recommended priorities;
- overdue and due-today tasks;
- upcoming deadlines;
- blocked projects;
- unresolved decisions;
- business alerts and important metrics;
- recent activity;
- a prominent Ask Nexus input.

Nexus generates recommendations from real tasks, projects, daily records, goals, preferences, deadlines, and recent activity. Each recommendation must explain its basis and cite its sources.

### 2. Conversational Command Center

Users can converse with Nexus using whole-Vault, business, project, document, or manually selected context.

The assistant can:

- answer questions with source citations;
- summarize and compare records;
- generate plans and reports;
- identify blockers, conflicts, and missing information;
- translate natural-language requests into validated operation proposals;
- retain conversation summaries as approved long-term memory.

Conversation history is working context. Only approved summaries or explicit memory instructions become durable Vault memory.

### 3. Businesses

Businesses provide operational views over:

- purpose, goals, products, services, audience, and strategy;
- active projects and tasks;
- operating procedures and recurring work;
- metrics, risks, blockers, and reports;
- people and relationship context explicitly provided by Kofi.

### 4. Projects

Each project exposes:

- snapshot and current state;
- current focus;
- roadmap and milestones;
- tasks and dependencies;
- decisions, assumptions, and open questions;
- documents and activity history;
- project-scoped chat.

### 5. Tasks

Tasks support:

- create, read, update, complete, reopen, archive, and delete;
- priority, status, due date, owner, business, project, recurrence, dependencies, and blockers;
- list, board, today, upcoming, overdue, and completed views;
- source links and change history;
- AI-assisted prioritization without silently changing authoritative task state.

### 6. Inbox And Capture

The inbox accepts quick notes, ideas, tasks, requests, and unclassified information. Nexus may propose destinations and classifications, but raw capture remains uncommitted until reviewed or explicitly promoted.

### 7. Documents And Knowledge

Users can browse, search, create, edit, preview, append, move, archive, delete, and restore Markdown content. The interface includes metadata, backlinks, source relationships, Git history, and before/after diffs.

### 8. Memory

Long-term memory includes:

- confirmed identity and profile information;
- working preferences and routines;
- goals and priorities;
- businesses and projects;
- decisions and lessons;
- approved conversation summaries;
- daily notes and operational history.

Nexus may suggest memory updates, but it must show the proposed content and source before persistence. Inference is not automatically durable truth.

### 9. Reports

Nexus generates traceable daily, weekly, business, project, task, and activity reports from current Vault records. Reports must distinguish facts from AI recommendations.

### 10. Activity And Audit

The activity view records:

- manual and AI-proposed operations;
- approvals and rejections;
- affected paths and revisions;
- Git commits;
- validation and conflict failures;
- restore and rollback operations.

### 11. Settings And Administration

Settings manage:

- future authentication and session security;
- Vault repository and branch configuration;
- NVIDIA model configuration;
- approval and destructive-operation policies;
- allowed paths and operation scopes;
- retention, privacy, and memory rules.

## Primary Navigation

```text
Today
Chat
Businesses
Projects
Tasks
Inbox
Documents
Knowledge
Memory
Daily Notes
Reports
Activity
Settings
```

## Core Workflows

### Daily planning

1. Retrieve active tasks, projects, deadlines, blockers, goals, preferences, and recent notes.
2. Apply deterministic filters for overdue, due-today, and explicitly prioritized work.
3. Send only bounded relevant context to NVIDIA when ranking or synthesis is needed.
4. Present recommendations with reasons and citations.
5. Allow the user to accept, edit, schedule, or reject the plan.
6. Persist only approved changes.

### Conversational read

1. Resolve the requested scope.
2. Retrieve exact registry entries and relevant Markdown.
3. Build a bounded context manifest.
4. Ask NVIDIA to answer from that context.
5. Return the answer with cited source paths and revision information.

### Conversational write

1. Interpret the request into a structured operation proposal.
2. Check the requested action against operation policy.
3. Read the current file and revision.
4. Validate path, schema, operation type, and expected state.
5. Produce a before/after diff.
6. Require approval for material or destructive changes.
7. Apply the operation using optimistic concurrency.
8. Verify by readback and record the Git commit and audit event.

### Manual administration

Manual forms and editors call the same services, validation, revision checks, audit pipeline, and Git integration as conversational operations.

## Functional Requirements

### Deterministic retrieval

- Retrieve projects, businesses, documents, tasks, and registries without AI.
- Read exact Vault paths and revisions.
- Support bounded text search and registered-document discovery.
- Return source paths and revision identifiers.
- Never load the entire Vault by default.

### NVIDIA reasoning

NVIDIA is used for:

- natural-language conversation;
- intent interpretation;
- synthesis and summarization;
- planning and prioritization;
- report generation;
- operation proposal generation.

NVIDIA is not used for:

- authentication or authorization;
- exact file retrieval;
- permission decisions;
- schema validation;
- GitHub writes;
- revision conflict detection;
- audit history;
- final approval.

### Vault CRUD

Nexus must support controlled:

- create;
- read;
- replace and partial update;
- append;
- move and rename;
- archive;
- delete;
- restore and rollback.

All writes require server-side validation and current-revision checks. Hard deletion requires explicit destructive confirmation; archive is the default removal strategy.

### Search And citations

Answers and generated plans must expose the Vault sources used. Search results must remain usable without invoking NVIDIA.

### Long-term memory

- Durable memory is stored in reviewed Vault records.
- Conversation transcripts are not automatically canonical memory.
- The assistant may propose a concise memory summary.
- The user can approve, edit, reject, forget, or correct stored memory.
- Conflicting memories remain visible until resolved.

## Security And Privacy

- The Nexus Vault must be private before storing confidential personal, client, operational, or financial information.
- Authentication is deferred for the MVP; do not expose mutation APIs beyond trusted local/private networks.
- GitHub and NVIDIA credentials remain server-side and use least privilege.
- Sensitive values are never written to Markdown, logs, responses, or model prompts.
- Destructive operations require explicit confirmation.
- All mutation requests use path allowlists and revision checks.
- Model output is untrusted input and must pass deterministic validation.
- Access, mutation, and approval events are auditable.

## First Functional Release

The first functional release should focus on:

1. public MVP workspace access;
2. private Vault readiness;
3. project and Markdown navigation;
4. deterministic document reading and search;
5. task management and Today dashboard;
6. manual administrative CRUD;
7. diff preview, approval, Git commits, and activity history;
8. Vault-aware NVIDIA conversation with citations;
9. approved memory summaries.

## Out Of Scope For The First Functional Release

- unapproved autonomous writes;
- multi-user organizations and delegated roles;
- automatic financial transactions;
- arbitrary external-system execution;
- a vector database before repository-native retrieval proves insufficient;
- silent learning from private data or conversation;
- claiming completion without verification.

## Success Criteria

The target product is successful when Kofi can:

- ask what to work on today and receive a source-grounded recommendation;
- converse with Nexus using selected Vault context;
- manually create, read, edit, append, archive, delete, and restore supported records;
- ask Nexus to propose the same operations through conversation;
- inspect and approve material changes before they are written;
- trace every mutation to a user, operation, path, revision, and Git commit;
- correct or remove long-term memory;
- operate the Vault without exposing credentials or relying on AI for exact retrieval.

## Delivery Roadmap

### Phase 1 — Verified read workspace

- Project detail pages
- Markdown browsing and rendering
- Registered-document discovery
- Bounded deterministic search
- Source and revision display

### Phase 2 — Operational core

- Task schema and management
- Today dashboard
- Inbox and daily notes
- Businesses and project operations views
- Reports from deterministic records

### Phase 3 — Controlled administration

- Authentication deferred beyond MVP
- Private Vault configuration
- Manual CRUD
- optimistic concurrency and conflict handling
- diff preview and approval
- activity log, Git evidence, archive, and rollback

### Phase 4 — Conversational reasoning

- NVIDIA provider adapter
- scoped Vault-aware chat
- source citations and context manifests
- structured operation proposals
- approved conversation summaries and memory updates

### Phase 5 — Command-center expansion

- recurring operations and workflows
- richer metrics and business reporting
- broader knowledge and relationship context
- derived indexes only where deterministic repository retrieval is insufficient

Roadmap phases describe intended sequence. A capability becomes current product truth only after implementation and verification evidence exists.
