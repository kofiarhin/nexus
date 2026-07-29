# Nexus Product Requirements Document

**Product:** Nexus  
**Status:** Foundation MVP approved  
**Application repository:** `kofiarhin/nexus`  
**Knowledge repository:** `kofiarhin/nexus-vault`

## Executive Summary

Nexus is an AI-native productivity and knowledge operating system. It provides one interface for capturing information, managing projects, editing Markdown, generating plans, searching knowledge, and working with project-aware AI. Markdown remains canonical and portable. GitHub stores durable knowledge and version history. The Express backend performs retrieval, orchestration, validation, and workflow execution. NVIDIA AI is used only where reasoning is required.

## Product Principles

1. Markdown is canonical.
2. GitHub stores durable knowledge but is not the reasoning layer.
3. Deterministic retrieval happens before AI.
4. The Vault remains usable without Nexus.
5. The browser never communicates directly with GitHub or NVIDIA.
6. MVP operations are observable, scoped, and safe.

## Architecture

```text
User
  ↓
React/Vite client on Vercel
  ↓
Express API on Heroku
  ↓
GitHub API → Nexus Vault
  ↓
NVIDIA AI for reasoning-only workflows
```

## Repository Model

### Application repository

`kofiarhin/nexus` contains the React client, Express server, tests, scripts, and product documentation. It uses one root `package.json`, one lock file, and root-level commands.

### Knowledge repository

`kofiarhin/nexus-vault` contains canonical Markdown only. Its major areas are identity, inbox, registry, projects, daily notes, planning, knowledge, areas, people, templates, system configuration, assets, and archive.

## MVP Goals

- Provide a responsive client shell.
- Expose a versioned Express API.
- Connect to the Vault through server-side GitHub credentials.
- List projects deterministically from `registry/PROJECTS.md`.
- Provide service and Vault health endpoints.
- Return consistent success and error envelopes with request IDs.
- Preserve a clear MVC boundary.
- Establish automated tests and deployment-ready entrypoints.
- Retain the approved PRD and technical specification under `docs/`.

## Foundation MVP Scope

The first implementation includes repository bootstrap, React/Vite, Express MVC, environment validation, CORS, request IDs, standard errors, health routes, read-only GitHub access, deterministic project parsing, initial tests, Vercel-compatible client output, and a Heroku `Procfile`.

## Out of Scope for This Milestone

Authentication, Vault writes, project creation, Markdown editing, chat, intent classification, NVIDIA integration, semantic search, daily capture, daily planning, deployment execution, merge, and production verification are deferred.

## Initial API

- `GET /api/v1/health`
- `GET /api/v1/health/vault`
- `GET /api/v1/projects`

## Security

The MVP has no application authentication. Therefore all implemented Vault operations remain read-only. Tokens stay server-side in environment variables. Responses must not expose credentials or upstream payloads containing sensitive data.

## Success Criteria

- The root project can be installed and run using documented npm commands.
- The client builds successfully.
- The API starts on the environment-provided port.
- Health routes use the standard response envelope.
- Project listing reads the registry without invoking AI.
- Missing configuration and upstream failures are controlled.
- Tests cover environment validation, health, and deterministic project listing.

## Future Roadmap

Later milestones may add project detail retrieval, Markdown editing, approved Vault writes, search, daily notes, planning, chat, intent routing, NVIDIA reasoning, authentication, CI/CD, production deployment, and runtime verification.
