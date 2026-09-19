import { describe, expect, it } from 'vitest';
import { canAutoExecute, classifyRisk, requiresDestructiveConfirmation } from '../../server/config/policy.js';

describe('classifyRisk', () => {
  it('treats delete as destructive everywhere', () => {
    expect(classifyRisk({ action: 'delete', path: 'tasks/TASKS.md' })).toBe('destructive');
    expect(classifyRisk({ action: 'delete', path: 'inbox/INBOX.md' })).toBe('destructive');
  });

  it('treats capture-surface edits as low risk', () => {
    expect(classifyRisk({ action: 'append', path: 'inbox/INBOX.md' })).toBe('low');
    expect(classifyRisk({ action: 'replace', path: 'tasks/TASKS.md' })).toBe('low');
    expect(classifyRisk({ action: 'create', path: 'daily/2026-07-31.md' })).toBe('low');
  });

  it('treats a per-project task document as a task surface', () => {
    expect(classifyRisk({ action: 'replace', path: 'projects/nexus/TASKS.md' })).toBe('low');
  });

  it('treats knowledge, project, and memory edits as material', () => {
    expect(classifyRisk({ action: 'replace', path: 'projects/nexus/PROJECT.md' })).toBe('material');
    expect(classifyRisk({ action: 'append', path: 'memory/MEMORY.md' })).toBe('material');
    expect(classifyRisk({ action: 'create', path: 'knowledge/topic.md' })).toBe('material');
    expect(classifyRisk({ action: 'replace', path: 'registry/PROJECTS.md' })).toBe('material');
  });

  it('keeps move and archive material even on capture surfaces', () => {
    expect(classifyRisk({ action: 'move', path: 'tasks/TASKS.md' })).toBe('material');
    expect(classifyRisk({ action: 'archive', path: 'inbox/INBOX.md' })).toBe('material');
  });

  it('does not treat a shared name prefix as a capture surface', () => {
    expect(classifyRisk({ action: 'replace', path: 'tasks-private/SECRET.md' })).toBe('material');
  });
});

describe('canAutoExecute', () => {
  it('permits combining approval and execution only for low-risk manual operations', () => {
    expect(canAutoExecute({ risk: 'low', source: 'manual', autoApproveLowRisk: true })).toBe(true);
  });

  it('never combines them for material or destructive operations', () => {
    expect(canAutoExecute({ risk: 'material', source: 'manual', autoApproveLowRisk: true })).toBe(false);
    expect(canAutoExecute({ risk: 'destructive', source: 'manual', autoApproveLowRisk: true })).toBe(false);
  });

  it('never combines them for conversational operations', () => {
    expect(canAutoExecute({ risk: 'low', source: 'conversation', autoApproveLowRisk: true })).toBe(false);
  });

  it('respects the configured policy switch', () => {
    expect(canAutoExecute({ risk: 'low', source: 'manual', autoApproveLowRisk: false })).toBe(false);
  });
});

describe('requiresDestructiveConfirmation', () => {
  it('applies only to destructive risk', () => {
    expect(requiresDestructiveConfirmation('destructive')).toBe(true);
    expect(requiresDestructiveConfirmation('material')).toBe(false);
  });
});
