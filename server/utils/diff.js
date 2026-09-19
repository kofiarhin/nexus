/**
 * Minimal unified-diff generator.
 *
 * Written in-repository rather than pulled from a dependency because diffs are
 * shown to the owner before approving a Vault mutation: the exact output has to
 * be deterministic and testable.
 */

const CONTEXT_LINES = 3;

function splitLines(text) {
  const value = text ?? '';
  if (value === '') return [];
  return value.split('\n');
}

/**
 * Longest-common-subsequence table over lines. Inputs are bounded by
 * MAX_DIFF_LINES so a large file cannot allocate an unbounded matrix.
 */
const MAX_DIFF_LINES = 4000;

function lcsMatrix(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/** Produces `{ type: 'equal'|'add'|'remove', value }` entries. */
export function diffLines(beforeText, afterText) {
  const a = splitLines(beforeText);
  const b = splitLines(afterText);

  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      { type: 'remove', value: `<${a.length} lines>` },
      { type: 'add', value: `<${b.length} lines>` }
    ];
  }

  const table = lcsMatrix(a, b);
  const changes = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      changes.push({ type: 'equal', value: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      changes.push({ type: 'remove', value: a[i] });
      i += 1;
    } else {
      changes.push({ type: 'add', value: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    changes.push({ type: 'remove', value: a[i] });
    i += 1;
  }
  while (j < b.length) {
    changes.push({ type: 'add', value: b[j] });
    j += 1;
  }

  return changes;
}

function groupHunks(changes) {
  const changedIndexes = changes
    .map((change, index) => (change.type === 'equal' ? -1 : index))
    .filter((index) => index !== -1);

  if (changedIndexes.length === 0) return [];

  const ranges = [];
  for (const index of changedIndexes) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(changes.length - 1, index + CONTEXT_LINES);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}

/** Unified diff text for display and audit. */
export function createUnifiedDiff(beforeText, afterText, { fromPath = 'a', toPath = 'b' } = {}) {
  const changes = diffLines(beforeText, afterText);
  const hunks = groupHunks(changes);
  if (hunks.length === 0) return '';

  const lines = [`--- ${fromPath}`, `+++ ${toPath}`];

  // Line numbers are tracked while scanning so hunk headers stay accurate.
  const positions = [];
  let beforeLine = 1;
  let afterLine = 1;
  for (const change of changes) {
    positions.push({ beforeLine, afterLine });
    if (change.type !== 'add') beforeLine += 1;
    if (change.type !== 'remove') afterLine += 1;
  }

  for (const { start, end } of hunks) {
    const slice = changes.slice(start, end + 1);
    const beforeCount = slice.filter((change) => change.type !== 'add').length;
    const afterCount = slice.filter((change) => change.type !== 'remove').length;
    const startPosition = positions[start];
    lines.push(
      `@@ -${beforeCount ? startPosition.beforeLine : 0},${beforeCount} `
      + `+${afterCount ? startPosition.afterLine : 0},${afterCount} @@`
    );
    for (const change of slice) {
      const marker = change.type === 'add' ? '+' : change.type === 'remove' ? '-' : ' ';
      lines.push(`${marker}${change.value}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function diffStats(beforeText, afterText) {
  const changes = diffLines(beforeText, afterText);
  return {
    added: changes.filter((change) => change.type === 'add').length,
    removed: changes.filter((change) => change.type === 'remove').length,
    unchanged: changes.filter((change) => change.type === 'equal').length
  };
}
