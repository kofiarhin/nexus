import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Writes starter Vault documents to a local directory.
 *
 * This never touches GitHub and never overwrites an existing file, so it is
 * safe to run against a checkout of an existing Vault. Review the output, then
 * commit it to the Vault repository yourself.
 */

const target = resolve(process.argv[2] ?? './vault-bootstrap');

const FILES = {
  'NEXUS.md': `# Nexus workspace rules

Rules Nexus should follow when reasoning over this Vault.

## Operating contract

- Markdown in this repository is canonical.
- Deterministic retrieval happens before any AI reasoning.
- Proposals are not changes. Nothing is written without explicit approval.
`,

  'registry/PROJECTS.md': `# Projects

| ID | Name | Status | Path | Updated |
| --- | --- | --- | --- | --- |
| nexus | Nexus | active | projects/nexus/PROJECT.md | 2026-07-31 |
`,

  'registry/BUSINESSES.md': `# Businesses

| ID | Name | Status | Path | Updated |
| --- | --- | --- | --- | --- |
| example | Example Business | active | businesses/example/BUSINESS.md | 2026-07-31 |
`,

  'projects/nexus/PROJECT.md': `---
name: Nexus
lifecycle: active
updatedAt: 2026-07-31
---

# Nexus

## Current state

The command center reads this document deterministically.

## Current focus

Describe what is being worked on right now.

## Roadmap

- First milestone

## Decisions

- Markdown stays canonical

## Assumptions

- The Vault repository is private

## Open questions

- What belongs in knowledge versus project documents?
`,

  'projects/nexus/TASKS.md': `# Nexus tasks

## Open

- [ ] Describe the first project task @priority(high) @project(nexus)
`,

  'businesses/example/BUSINESS.md': `---
name: Example Business
status: active
updatedAt: 2026-07-31
---

# Example Business

## Purpose

What this business exists to do.

## Goals

- First goal

## Products and services

- First offering

## Strategy

How the goals will be reached.

## Metrics

- Metric to watch

## Risks

- Known risk

## Blockers

- Current blocker
`,

  'tasks/TASKS.md': `# Tasks

Tasks are annotated Markdown checklist items. Every annotation is optional.

## Open

- [ ] Review the Nexus setup @priority(high) @due(2026-08-07) @owner(kofi)
`,

  'inbox/INBOX.md': `# Inbox

Raw capture. Items stay here until they are explicitly reviewed or promoted.

## Captured
`,

  'memory/MEMORY.md': `# Long-term memory

Only reviewed and approved statements belong here.

## Records
`,

  'knowledge/README.md': `# Knowledge

Durable reference notes. One topic per file.
`,

  'daily/README.md': `# Daily notes

One file per day, named YYYY-MM-DD.md, with Plan, Notes, Events, Outcomes, and
Reflections sections.
`
};

const exists = async (path) => access(path).then(() => true).catch(() => false);

let written = 0;
let skipped = 0;

for (const [relativePath, content] of Object.entries(FILES)) {
  const absolute = join(target, relativePath);
  if (await exists(absolute)) {
    skipped += 1;
    continue;
  }
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
  written += 1;
}

console.log(`Bootstrap Vault written to ${target}`);
console.log(`${written} file(s) created, ${skipped} existing file(s) left untouched.`);
console.log('Review the output, then commit it to your private Vault repository.');
