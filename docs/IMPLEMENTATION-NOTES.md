# Nexus Implementation Notes

Notes for the command-center implementation on `claude/nexus-command-center-full`. The approved
product direction in [PRD.md](PRD.md) and [SPECIFICATION.md](SPECIFICATION.md) is unchanged; this
file records decisions, deviations, and gaps discovered while building.

Implementation, merge, deployment, and verification remain separate states. Nothing here claims a
capability is verified in production.

## Decisions taken during implementation

### Task record format

The specification names the task fields but not their Markdown encoding. Tasks are annotated
checklist items — `- [ ] Name @key(value)` — in `tasks/TASKS.md` and any `projects/<id>/TASKS.md`.

Every annotation is optional. A plain `- [ ] Do the thing` parses into a complete task with defaults
and a stable id derived from its source path and text, so an existing Vault needs no migration and a
hand-edited file is never misread. The checkbox is authoritative for completion, which keeps a
manually ticked box correct even if a stale `@status()` annotation disagrees.

Memory and inbox records reuse the same annotation syntax on plain bullets.

### Risk classification

`classifyRisk` keys on action plus path. Capture surfaces (`inbox/`, `daily/`, `tasks/`) and any
document named `TASKS.md` are low risk for create, append, replace, and patch: they are high-volume,
routine, and fully recoverable from Git.

`TASKS.md` is matched by basename rather than prefix so a per-project task file behaves like the
shared one. Without that, editing a task in `projects/nexus/TASKS.md` would require an approval while
the identical edit in `tasks/TASKS.md` would not.

Move and archive are always material because they relocate a record. Delete is always destructive.

### Approval evidence for memory operations

Memory changes reach the operation pipeline only through an explicit owner action on a named record
(approve this proposal, correct this statement, forget this record). That request is recorded as the
approval evidence before execution, rather than requiring a second approval for a decision the owner
has already made explicitly.

### Client router written in-repository

`client/lib/router.jsx` is roughly 120 lines providing path parameters, a `/documents/*` wildcard,
`Link`, and `NavLink`.

`react-router-dom` was installed first and removed: every currently published release of the
`react-router` line carries open advisories (SSR, RSC, and framework-mode issues). None apply to a
client-only SPA with no server rendering, but shipping a dependency that `npm audit` flags is worse
than 120 lines of routing. `npm audit` reports zero vulnerabilities.

### Markdown rendered to React elements

`client/lib/markdown.jsx` renders Markdown directly to React elements rather than producing an HTML
string. Nothing is assigned through `dangerouslySetInnerHTML`, so embedded HTML in a Vault document
cannot execute, and link targets pass an explicit protocol allowlist. This satisfies the
sanitization requirement without a renderer plus a sanitizer dependency.

### Diff generated in-repository

`server/utils/diff.js` is an LCS-based unified-diff generator. Diffs are shown to the owner before
approving a Vault mutation, so the output has to be deterministic and directly testable. Input is
bounded at 4000 lines so a large document cannot allocate an unbounded matrix.

### Session and CSRF handling

Sessions are stateless HMAC-signed cookies (`httpOnly`, `SameSite=Lax`), and passwords are hashed with
scrypt from `node:crypto`. No session store or additional dependency is involved.

CSRF uses a double-submit token, applied only to mutating requests that actually carry a session
cookie. Sign-in has no session to ride on yet, and every other unauthenticated mutation is refused by
the auth guard regardless.

### Writes gated on authentication

`WRITE_OPERATIONS_ENABLED=true` alone does not enable writes. `loadEnv` also requires
`AUTH_ENABLED=true` and configured owner credentials, because specification section 8 forbids
reachable unauthenticated mutations. `GET /api/v1/settings` reports both the requested and the
effective state so the discrepancy is visible rather than silent.

## Deviations from the specification

1. **`GET /api/v1/projects` now requires authentication.** It was previously public. Specification
   section 8 requires that unauthenticated requests cannot read private operational content. The
   existing integration tests for that route were updated to run with `AUTH_ENABLED=false`, since
   their subject is Vault error normalization; authentication has its own suite.

2. **`GET /health/vault` gained two fields.** It now also reports `writeOperationsEnabled` and
   `destructiveOperationsEnabled`. Existing fields are unchanged.

3. **Additional error codes.** The specification lists codes it "includes". This build adds
   `AUTH_NOT_CONFIGURED`, `INVALID_CREDENTIALS`, `VAULT_FILE_EXISTS`, `VAULT_WRITE_DISABLED`,
   `AI_TIMEOUT`, `RATE_LIMITED`, `CSRF_TOKEN_INVALID`, and `CONFLICT`, each mapped to a specific
   failure that would otherwise collapse into a vaguer code.

4. **Additional routes.** Beyond section 18 the build adds `GET /auth/status`, `GET /tasks/summary`,
   `GET /operations`, `GET /conversations`, `DELETE /conversations/:id`, inbox, daily-note, knowledge,
   report, and settings routes. These are required by the client pages the PRD specifies.

5. **`GET /knowledge/note?path=` uses a query parameter** rather than a path segment, so Vault paths
   containing slashes need no double encoding.

## Bugs found and fixed by the tests

- `NavLink` passed `onClick` through to `Link`, where the spread overrode the router's own click
  handler. Sidebar navigation did nothing. `Link` now composes both handlers.
- The modal dialog's focus effect depended on an inline `onClose` prop, so it re-ran on every render
  and pulled focus out of the field being typed into after each keystroke. The handler now lives in a
  ref and the effect depends only on open state.
- The CSRF middleware blocked sign-in itself, since no CSRF cookie exists before the first login.
- `mutateAsync` calls in event handlers produced unhandled rejections on failure. A `runMutation`
  helper awaits them safely; the error still renders from the mutation state.

## Known gaps

- **In-memory operational state.** Operations, audit events, conversations, and idempotency keys live
  in a bounded per-process store and are cleared on restart. They provide traceability alongside Git,
  which remains the durable record. Persisting them needs an approved storage decision.
- **No server-side session revocation.** Signing out clears the cookie; a stolen token remains valid
  until it expires or `SESSION_SECRET` changes.
- **Bounded search.** Each query reads at most `SEARCH_MAX_FILES` Markdown documents. Responses report
  `scanned` and `truncated`. A derived index is deliberately not added; the specification does not
  require one until repository-native retrieval proves insufficient.
- **Non-atomic move.** The GitHub Contents API has no rename. Move writes the destination, then
  deletes the source. A failure between the two leaves both copies rather than losing the record.
- **Streaming citations.** A streamed reply maps `[S1]` markers after the stream completes, so
  citations appear on the finished message rather than incrementally.
- **Unverified externally.** No live NVIDIA call, no production GitHub write, and no deployment has
  been executed from this branch. Every test drives in-memory fixtures for both integrations.
