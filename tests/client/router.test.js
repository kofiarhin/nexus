import { describe, expect, it } from 'vitest';
import { matchPath } from '../../client/lib/router.jsx';
import { isSafeHref, parseBlocks } from '../../client/lib/markdown.jsx';

describe('matchPath', () => {
  it('matches an exact route', () => {
    expect(matchPath('/today', '/today')).toEqual({});
    expect(matchPath('/today', '/tasks')).toBeNull();
  });

  it('captures path parameters', () => {
    expect(matchPath('/projects/:projectId', '/projects/nexus')).toEqual({ projectId: 'nexus' });
    expect(matchPath('/businesses/:businessId', '/businesses/acme')).toEqual({ businessId: 'acme' });
  });

  it('decodes encoded parameters', () => {
    expect(matchPath('/projects/:projectId', '/projects/my%20project')).toEqual({ projectId: 'my project' });
  });

  it('captures the remainder for a wildcard route', () => {
    expect(matchPath('/documents/*', '/documents/projects/nexus/PROJECT.md')).toEqual({
      '*': 'projects/nexus/PROJECT.md'
    });
  });

  it('does not let a wildcard route swallow a different prefix', () => {
    expect(matchPath('/documents/*', '/tasks/anything')).toBeNull();
  });

  it('rejects a partial match', () => {
    expect(matchPath('/projects/:projectId', '/projects')).toBeNull();
    expect(matchPath('/projects', '/projects/nexus')).toBeNull();
  });
});

describe('isSafeHref', () => {
  it('allows http, https, mailto, and relative links', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('mailto:owner@example.test')).toBe(true);
    expect(isSafeHref('/documents/a.md')).toBe(true);
    expect(isSafeHref('./sibling.md')).toBe(true);
    expect(isSafeHref('#section')).toBe(true);
  });

  it('blocks script-bearing and unexpected protocols', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHref('file:///etc/passwd')).toBe(false);
    expect(isSafeHref('')).toBe(false);
  });
});

describe('markdown block parsing', () => {
  it('parses headings, paragraphs, lists, and code fences', () => {
    const blocks = parseBlocks('# Title\n\nBody text.\n\n- one\n- two\n\n```js\ncode()\n```\n');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'code']);
    expect(blocks[2].items.map((item) => item.content)).toEqual(['one', 'two']);
    expect(blocks[3].content).toBe('code()');
  });

  it('parses checklist state', () => {
    const [list] = parseBlocks('- [x] done\n- [ ] open\n');
    expect(list.items).toEqual([
      { checked: true, content: 'done' },
      { checked: false, content: 'open' }
    ]);
  });

  it('does not treat fenced content as markup', () => {
    const blocks = parseBlocks('```\n# not a heading\n```\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('code');
  });

  it('parses tables and block quotes', () => {
    const blocks = parseBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n');
    expect(blocks.map((block) => block.type)).toEqual(['table', 'quote']);
  });
});
