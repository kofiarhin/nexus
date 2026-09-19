import { describe, expect, it } from 'vitest';
import { createUnifiedDiff, diffLines, diffStats } from '../../server/utils/diff.js';

describe('diffLines', () => {
  it('marks added, removed, and unchanged lines', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'equal', value: 'a' },
      { type: 'remove', value: 'b' },
      { type: 'add', value: 'x' },
      { type: 'equal', value: 'c' }
    ]);
  });

  it('treats an empty document as having no lines', () => {
    expect(diffLines('', 'new')).toEqual([{ type: 'add', value: 'new' }]);
  });
});

describe('createUnifiedDiff', () => {
  it('returns an empty diff when nothing changed', () => {
    expect(createUnifiedDiff('same\ncontent', 'same\ncontent')).toBe('');
  });

  it('produces a unified diff with headers and a hunk', () => {
    const diff = createUnifiedDiff('one\ntwo\nthree', 'one\nTWO\nthree', {
      fromPath: 'tasks/TASKS.md@abc',
      toPath: 'tasks/TASKS.md@proposed'
    });

    expect(diff).toContain('--- tasks/TASKS.md@abc');
    expect(diff).toContain('+++ tasks/TASKS.md@proposed');
    expect(diff).toMatch(/@@ -1,3 \+1,3 @@/);
    expect(diff).toContain('-two');
    expect(diff).toContain('+TWO');
  });

  it('shows an appended line as a single addition', () => {
    const diff = createUnifiedDiff('- one\n', '- one\n- two\n');
    expect(diff).toContain('+- two');
    expect(diff).not.toContain('-- one');
  });

  it('summarises very large documents instead of building a full matrix', () => {
    const big = Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n');
    const changes = diffLines(big, `${big}\nextra`);
    expect(changes).toHaveLength(2);
    expect(changes[0].type).toBe('remove');
  });
});

describe('diffStats', () => {
  it('counts added and removed lines', () => {
    expect(diffStats('a\nb', 'a\nb\nc')).toEqual({ added: 1, removed: 0, unchanged: 2 });
  });
});
