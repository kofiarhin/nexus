import { describe, expect, it } from 'vitest';
import {
  appendLine,
  extractTitle,
  findSection,
  parseAnnotatedListItems,
  parseAnnotationList,
  parseAnnotations,
  parseChecklistItems,
  parseFrontMatter,
  parseListItems,
  parseSections,
  parseTable,
  replaceLine,
  serializeAnnotations,
  serializeFrontMatter
} from '../../server/utils/markdown.js';

describe('parseFrontMatter', () => {
  it('parses scalars, booleans, numbers, and inline arrays', () => {
    const { data, body } = parseFrontMatter('---\nname: Nexus\nactive: true\ncount: 3\ntags: [a, b]\n---\n# Title\n');
    expect(data).toEqual({ name: 'Nexus', active: true, count: 3, tags: ['a', 'b'] });
    expect(body).toBe('# Title\n');
  });

  it('parses block list values', () => {
    const { data } = parseFrontMatter('---\ntags:\n  - first\n  - second\n---\nbody\n');
    expect(data.tags).toEqual(['first', 'second']);
  });

  it('returns the document unchanged when there is no front matter', () => {
    expect(parseFrontMatter('# Just a title\n')).toEqual({ data: {}, body: '# Just a title\n' });
  });

  it('round-trips through serializeFrontMatter', () => {
    const serialized = serializeFrontMatter({ name: 'Nexus', tags: ['a', 'b'] });
    expect(parseFrontMatter(`${serialized}body`).data).toEqual({ name: 'Nexus', tags: ['a', 'b'] });
  });
});

describe('parseSections', () => {
  const document = [
    '# Title',
    '',
    '## Current State',
    '',
    'Steady.',
    '',
    '## Open Questions',
    '',
    '- First question',
    '- Second question',
    ''
  ].join('\n');

  it('splits a document into headed sections', () => {
    const sections = parseSections(document);
    expect(sections.map((section) => section.heading)).toEqual(['Current State', 'Open Questions']);
  });

  it('finds sections case- and punctuation-insensitively', () => {
    const sections = parseSections(document);
    expect(findSection(sections, 'current state')).toBe('Steady.');
    expect(findSection(sections, 'open questions')).toContain('First question');
    expect(findSection(sections, 'missing')).toBe('');
  });

  it('ignores headings inside fenced code blocks', () => {
    const sections = parseSections('## Real\n\n```\n## Not a heading\n```\n');
    expect(sections.map((section) => section.heading)).toEqual(['Real']);
  });

  it('extracts list items with checkbox markers stripped', () => {
    expect(parseListItems('- [ ] first\n- second\n1. third\n')).toEqual(['first', 'second', 'third']);
  });

  it('reads the first level-one heading as a title', () => {
    expect(extractTitle('---\nname: x\n---\n\n# Real Title\n')).toBe('Real Title');
    expect(extractTitle('no heading here')).toBeNull();
  });
});

describe('parseTable', () => {
  it('keys rows by normalized header names', () => {
    const rows = parseTable('| ID | Name |\n| --- | --- |\n| nexus | Nexus |');
    expect(rows[0].id).toBe('nexus');
    expect(rows[0].name).toBe('Nexus');
  });
});

describe('annotations', () => {
  it('separates annotations from the remaining text', () => {
    expect(parseAnnotations('Review the plan @priority(high) @due(2026-08-01)')).toEqual({
      text: 'Review the plan',
      annotations: { priority: 'high', due: '2026-08-01' }
    });
  });

  it('leaves plain text untouched', () => {
    expect(parseAnnotations('Just a task')).toEqual({ text: 'Just a task', annotations: {} });
  });

  it('serializes annotations, omitting empty values', () => {
    expect(serializeAnnotations({ id: 'a', due: '', priority: 'low' })).toBe('@id(a) @priority(low)');
  });

  it('splits comma-separated annotation lists', () => {
    expect(parseAnnotationList('a, b ,c')).toEqual(['a', 'b', 'c']);
    expect(parseAnnotationList('')).toEqual([]);
  });
});

describe('parseChecklistItems', () => {
  it('records checked state, text, annotations, and line index', () => {
    const items = parseChecklistItems('# Tasks\n\n- [ ] Open one @id(a)\n- [x] Done one @id(b)\n');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ checked: false, text: 'Open one', line: 2 });
    expect(items[1]).toMatchObject({ checked: true, text: 'Done one', line: 3 });
  });

  it('ignores non-checklist bullets', () => {
    expect(parseChecklistItems('- plain bullet\n')).toHaveLength(0);
  });
});

describe('parseAnnotatedListItems', () => {
  it('reads plain bullets and skips checklist items', () => {
    const items = parseAnnotatedListItems('- A memory @type(fact)\n- [ ] A task\n');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: 'A memory', annotations: { type: 'fact' } });
  });
});

describe('replaceLine', () => {
  it('replaces a single line and leaves the rest untouched', () => {
    expect(replaceLine('a\nb\nc', 1, 'B')).toBe('a\nB\nc');
  });

  it('removes a line when the replacement is null', () => {
    expect(replaceLine('a\nb\nc', 1, null)).toBe('a\nc');
  });

  it('returns the document unchanged for an out-of-range index', () => {
    expect(replaceLine('a\nb', 9, 'x')).toBe('a\nb');
  });
});

describe('appendLine', () => {
  it('appends under a named heading, before the next heading', () => {
    const source = '# Tasks\n\n## Open\n\n- [ ] first\n\n## Done\n\n- [x] old\n';
    const result = appendLine(source, '- [ ] second', { underHeading: 'Open' });

    expect(result.changed).toBe(true);
    expect(result.content.split('\n').indexOf('- [ ] second'))
      .toBeLessThan(result.content.split('\n').indexOf('## Done'));
  });

  it('is retry-safe: appending identical content again changes nothing', () => {
    const source = '# Tasks\n\n## Open\n\n- [ ] first\n';
    const first = appendLine(source, '- [ ] second', { underHeading: 'Open' });
    const second = appendLine(first.content, '- [ ] second', { underHeading: 'Open' });

    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
    expect(second.content.match(/- \[ \] second/g)).toHaveLength(1);
  });

  it('creates the heading when it does not exist', () => {
    const result = appendLine('# Inbox\n', '- captured', { underHeading: 'Captured' });
    expect(result.content).toContain('## Captured');
    expect(result.content).toContain('- captured');
  });

  it('appends at the end when no heading is named', () => {
    expect(appendLine('a', '- b').content).toBe('a\n- b\n');
  });
});
