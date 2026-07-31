import { describe, expect, it } from 'vitest';
import { parseProjects } from '../../server/repositories/projectRepository.js';

const legacyRegistry = [
  '# Projects',
  '',
  '| Project | Summary |',
  '| --- | --- |',
  '| [Alpha](projects/alpha.md) | First project |',
  '| [Beta Program](projects/beta-program.md) | Second project |',
  ''
].join('\n');

const structuredRegistry = [
  '# Projects',
  '',
  '| ID | Name | Status | Path | Updated |',
  '|---|---|---|---|---|',
  '| nexus | Nexus | foundation | projects/nexus/INDEX.md | 2026-07-30 |',
  '| brain | Brain | active | projects/brain.md | 2026-07-29 |',
  ''
].join('\n');

describe('parseProjects', () => {
  describe('structured Vault registry format', () => {
    it('parses structured rows into project records', () => {
      expect(parseProjects(structuredRegistry)).toEqual([
        {
          name: 'Nexus',
          slug: 'nexus',
          path: 'projects/nexus/INDEX.md',
          summary: 'Status: foundation'
        },
        {
          name: 'Brain',
          slug: 'brain',
          path: 'projects/brain.md',
          summary: 'Status: active'
        }
      ]);
    });

    it('prefers the registry ID over the derived path slug', () => {
      const markdown = [
        '| ID | Name | Status | Path | Updated |',
        '| --- | --- | --- | --- | --- |',
        '| custom-id | Nexus | foundation | projects/nexus/INDEX.md | 2026-07-30 |'
      ].join('\n');

      expect(parseProjects(markdown)[0].slug).toBe('custom-id');
    });

    it('derives the slug from the path when the ID cell is empty', () => {
      const markdown = '|  | Nexus | foundation | projects/nexus/INDEX.md | 2026-07-30 |';

      expect(parseProjects(markdown)[0].slug).toBe('nexus');
    });

    it('omits the summary when the status cell is empty', () => {
      const markdown = '| nexus | Nexus |  | projects/nexus/INDEX.md | 2026-07-30 |';

      expect(parseProjects(markdown)).toEqual([
        { name: 'Nexus', slug: 'nexus', path: 'projects/nexus/INDEX.md', summary: '' }
      ]);
    });

    it('falls back to the slug when the name cell is empty', () => {
      const markdown = '| nexus |  | foundation | projects/nexus/INDEX.md | 2026-07-30 |';

      expect(parseProjects(markdown)[0].name).toBe('nexus');
    });

    it('tolerates a trailing updated column being omitted', () => {
      const markdown = '| nexus | Nexus | foundation | projects/nexus/INDEX.md |';

      expect(parseProjects(markdown)).toEqual([
        {
          name: 'Nexus',
          slug: 'nexus',
          path: 'projects/nexus/INDEX.md',
          summary: 'Status: foundation'
        }
      ]);
    });
  });

  describe('legacy linked format', () => {
    it('parses linked table rows into project records', () => {
      expect(parseProjects(legacyRegistry)).toEqual([
        { name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: 'First project' },
        {
          name: 'Beta Program',
          slug: 'beta-program',
          path: 'projects/beta-program.md',
          summary: 'Second project'
        }
      ]);
    });

    it('defaults a missing summary cell to an empty string', () => {
      expect(parseProjects('| [Alpha](projects/alpha.md) |')).toEqual([
        { name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: '' }
      ]);
    });

    it('normalizes an INDEX.md link target to the directory slug', () => {
      expect(parseProjects('| [Nexus](projects/nexus/INDEX.md) | AI-native productivity system |')).toEqual([
        {
          name: 'Nexus',
          slug: 'nexus',
          path: 'projects/nexus/INDEX.md',
          summary: 'AI-native productivity system'
        }
      ]);
    });
  });

  describe('mixed formats', () => {
    it('parses structured and linked rows from one registry file', () => {
      const markdown = [
        '| ID | Name | Status | Path | Updated |',
        '| --- | --- | --- | --- | --- |',
        '| nexus | Nexus | foundation | projects/nexus/INDEX.md | 2026-07-30 |',
        '',
        '| Project | Summary |',
        '| --- | --- |',
        '| [Alpha](projects/alpha.md) | First project |'
      ].join('\n');

      expect(parseProjects(markdown)).toEqual([
        {
          name: 'Nexus',
          slug: 'nexus',
          path: 'projects/nexus/INDEX.md',
          summary: 'Status: foundation'
        },
        { name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: 'First project' }
      ]);
    });

    it('parses interleaved rows without relying on a preceding header', () => {
      const markdown = [
        '| [Alpha](projects/alpha.md) | First project |',
        '| nexus | Nexus | foundation | projects/nexus/INDEX.md | 2026-07-30 |'
      ].join('\n');

      expect(parseProjects(markdown).map((project) => project.slug)).toEqual(['alpha', 'nexus']);
    });
  });

  describe('slug normalization', () => {
    it('normalizes INDEX.md paths to the containing directory', () => {
      const markdown = '| nexus | Nexus | foundation | projects/nexus/INDEX.md | 2026-07-30 |';

      expect(parseProjects(markdown)[0].slug).toBe('nexus');
      expect(parseProjects(markdown)[0].slug).not.toBe('nexus/INDEX');
    });

    it('normalizes direct .md paths to the file name', () => {
      const markdown = [
        '|  | Brain | active | projects/brain.md | 2026-07-29 |',
        '| [Beta Program](projects/beta-program.md) | Second project |'
      ].join('\n');

      expect(parseProjects(markdown).map((project) => project.slug)).toEqual([
        'brain',
        'beta-program'
      ]);
    });

    it('normalizes nested paths without producing a nested slug', () => {
      const markdown = '|  | Deep | active | areas/research/deep/INDEX.md | 2026-07-29 |';

      expect(parseProjects(markdown)[0].slug).toBe('deep');
    });
  });

  describe('ignored rows', () => {
    it('ignores headers, separators, and prose', () => {
      const markdown = [
        'Some prose about the registry.',
        '| ID | Name | Status | Path | Updated |',
        '| --- | --- | --- | --- | --- |',
        '|:---|:---:|---:|---|---|',
        '| Project | Summary |',
        '| nexus | Nexus | foundation | projects/nexus/INDEX.md | 2026-07-30 |'
      ].join('\n');

      expect(parseProjects(markdown)).toEqual([
        {
          name: 'Nexus',
          slug: 'nexus',
          path: 'projects/nexus/INDEX.md',
          summary: 'Status: foundation'
        }
      ]);
    });

    it('ignores malformed rows and rows without a valid Markdown project path', () => {
      const markdown = [
        '| Not a link | Ignored |',
        '| nexus | Nexus | foundation | projects/nexus | 2026-07-30 |',
        '| nexus | Nexus | foundation | not a path.md | 2026-07-30 |',
        '| [External](https://example.com) | Ignored |',
        '||',
        '|',
        '| [Alpha](projects/alpha.md) | Kept |'
      ].join('\n');

      expect(parseProjects(markdown)).toEqual([
        { name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: 'Kept' }
      ]);
    });

    it('ignores a path that normalizes to an empty slug', () => {
      expect(parseProjects('| [Index](INDEX.md) | Ignored |')).toEqual([]);
    });
  });

  describe('empty registries', () => {
    it('returns an empty list for a registry with no project rows', () => {
      expect(parseProjects('# Projects\n\nNothing registered yet.\n')).toEqual([]);
    });

    it('returns an empty list for an empty registry file', () => {
      expect(parseProjects('')).toEqual([]);
    });

    it('returns an empty list for a header-only registry', () => {
      expect(parseProjects('| ID | Name | Status | Path | Updated |\n| --- | --- | --- | --- | --- |')).toEqual([]);
    });
  });

  describe('ordering and determinism', () => {
    it('preserves registry order for the legacy format', () => {
      expect(parseProjects(legacyRegistry).map((project) => project.slug)).toEqual([
        'alpha',
        'beta-program'
      ]);
    });

    it('preserves registry order for the structured format', () => {
      expect(parseProjects(structuredRegistry).map((project) => project.slug)).toEqual([
        'nexus',
        'brain'
      ]);
    });

    it('is deterministic across repeated parses', () => {
      expect(parseProjects(structuredRegistry)).toEqual(parseProjects(structuredRegistry));
    });
  });
});
