/**
 * Markdown parsing helpers shared by every repository.
 *
 * The Vault stays human-readable Markdown, so these helpers read structure out
 * of ordinary documents: optional front matter, `##` sections, pipe tables, and
 * annotated list items. Nothing here requires a document to be machine-authored.
 */

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function coerceScalar(raw) {
  const value = raw.trim();
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^\[.*\]$/.test(value)) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => coerceScalar(item))
      .filter((item) => item !== '');
  }
  const unquoted = value.replace(/^['"]|['"]$/g, '');
  return unquoted;
}

/**
 * Supports the flat subset of YAML the Vault needs: `key: value`, inline
 * arrays, and `- item` blocks. Anything richer is preserved in the body.
 */
export function parseFrontMatter(markdown) {
  const text = markdown ?? '';
  const match = text.match(FRONT_MATTER_PATTERN);
  if (!match) return { data: {}, body: text };

  const data = {};
  let currentKey = null;

  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(coerceScalar(listItem[1]));
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!pair) continue;
    currentKey = pair[1];
    data[currentKey] = pair[2].trim() === '' ? [] : coerceScalar(pair[2]);
  }

  return { data, body: text.slice(match[0].length) };
}

export function serializeFrontMatter(data) {
  const entries = Object.entries(data ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return '';
  const lines = entries.map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.join(', ')}]`;
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

/** Returns the first `# Heading` in a document, falling back to null. */
export function extractTitle(markdown) {
  const match = (markdown ?? '').match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/**
 * Splits a document into `## Heading` sections.
 * Returns `{ heading, level, body }` records in document order.
 */
export function parseSections(markdown) {
  const lines = (markdown ?? '').split(/\r?\n/);
  const sections = [];
  let current = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : line.match(/^(#{2,6})\s+(.+?)\s*$/);
    if (heading) {
      if (current) sections.push(current);
      current = { heading: heading[2].trim(), level: heading[1].length, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);

  return sections.map(({ heading, level, lines: body }) => ({
    heading,
    level,
    body: body.join('\n').trim()
  }));
}

const normalizeHeading = (heading) => heading.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Case- and punctuation-insensitive section lookup. */
export function findSection(sections, ...headings) {
  const wanted = headings.map(normalizeHeading);
  const found = sections.find((section) => wanted.includes(normalizeHeading(section.heading)));
  return found ? found.body : '';
}

/** Bullet items (`-`, `*`, `1.`) from a section body, with markers stripped. */
export function parseListItems(body) {
  return (body ?? '')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => match[1].replace(/^\[[ xX]\]\s*/, '').trim())
    .filter(Boolean);
}

const SEPARATOR_ROW_PATTERN = /^[\s|:-]+$/;

function splitRow(line) {
  const cells = line.trim().split('|').map((cell) => cell.trim());
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** Raw pipe-table rows, separator rows removed. */
export function parseTableRows(markdown) {
  return (markdown ?? '')
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|') && !SEPARATOR_ROW_PATTERN.test(line))
    .map(splitRow)
    .filter((cells) => cells.length > 0);
}

/** Table rows keyed by their header cells, for registries with named columns. */
export function parseTable(markdown) {
  const rows = parseTableRows(markdown);
  if (rows.length < 2) return [];
  const headers = rows[0].map((cell) => normalizeHeading(cell).replace(/\s+/g, ''));
  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? '';
    });
    record._cells = cells;
    return record;
  });
}

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/;

/** Extracts `[Text](path)` from a cell, or returns the plain text. */
export function parseLinkCell(cell) {
  const match = (cell ?? '').match(LINK_PATTERN);
  if (!match) return { text: (cell ?? '').trim(), path: null };
  return { text: match[1].trim(), path: match[2].trim() };
}

const ANNOTATION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_-]*)\(([^)]*)\)/g;

/**
 * Reads `@key(value)` annotations out of a line and returns the remaining text.
 * This keeps operational records readable in plain Markdown while still giving
 * deterministic structure.
 */
export function parseAnnotations(line) {
  const annotations = {};
  const text = String(line ?? '').replace(ANNOTATION_PATTERN, (_match, key, value) => {
    annotations[key.toLowerCase()] = value.trim();
    return '';
  });
  return { text: text.replace(/\s{2,}/g, ' ').trim(), annotations };
}

export function serializeAnnotations(annotations) {
  return Object.entries(annotations ?? {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(([key, value]) => `@${key}(${String(value).trim()})`)
    .join(' ');
}

/** Splits an annotation value written as a comma-separated list. */
export function parseAnnotationList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Checklist items: `- [ ] text` / `- [x] text`, with any annotations parsed.
 * Returns the source line index so a record can be rewritten in place.
 */
export function parseChecklistItems(markdown) {
  return (markdown ?? '')
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$/);
      if (!match) return null;
      const { text, annotations } = parseAnnotations(match[4]);
      return {
        line: index,
        raw: line,
        indent: match[1],
        marker: match[2],
        checked: match[3].toLowerCase() === 'x',
        text,
        annotations
      };
    })
    .filter(Boolean);
}

/** Plain (non-checklist) annotated bullets, used by memory and inbox records. */
export function parseAnnotatedListItems(markdown) {
  return (markdown ?? '')
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^(\s*)([-*+])\s+(?!\[[ xX]\])(.*)$/);
      if (!match) return null;
      const { text, annotations } = parseAnnotations(match[3]);
      if (!text) return null;
      return { line: index, raw: line, indent: match[1], marker: match[2], text, annotations };
    })
    .filter(Boolean);
}

/** Replaces a single line, preserving the document's other content exactly. */
export function replaceLine(markdown, lineIndex, replacement) {
  const lines = (markdown ?? '').split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown ?? '';
  if (replacement === null) lines.splice(lineIndex, 1);
  else lines[lineIndex] = replacement;
  return lines.join('\n');
}

/**
 * Appends a line under a heading when one is named, otherwise at the end.
 * Returns the document unchanged when the exact line is already present, which
 * is what makes append retry-safe.
 */
export function appendLine(markdown, line, { underHeading = null } = {}) {
  const text = markdown ?? '';
  if (text.split(/\r?\n/).some((existing) => existing.trim() === line.trim())) {
    return { content: text, changed: false };
  }

  const lines = text.split('\n');

  if (underHeading) {
    const headingIndex = lines.findIndex(
      (candidate) => /^#{1,6}\s+/.test(candidate)
        && normalizeHeading(candidate.replace(/^#+\s+/, '')) === normalizeHeading(underHeading)
    );
    if (headingIndex !== -1) {
      let insertAt = lines.length;
      for (let index = headingIndex + 1; index < lines.length; index += 1) {
        if (/^#{1,6}\s+/.test(lines[index])) {
          insertAt = index;
          break;
        }
      }
      while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1;
      lines.splice(insertAt, 0, line);
      return { content: lines.join('\n'), changed: true };
    }
    const separator = text.endsWith('\n') || text === '' ? '' : '\n';
    return {
      content: `${text}${separator}\n## ${underHeading}\n\n${line}\n`,
      changed: true
    };
  }

  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  return { content: `${text}${separator}${line}\n`, changed: true };
}
