import { describe, expect, it } from 'vitest';
import { parseProjects } from '../../server/repositories/projectRepository.js';

const registry = [
  '# Projects',
  '',
  '| Project | Summary |',
  '| --- | --- |',
  '| [Alpha](projects/alpha.md) | First project |',
  '| [Beta Program](projects/beta-program.md) | Second project |',
  ''
].join('\n');

describe('parseProjects', () => {
  it('parses linked table rows into project records', () => {
    expect(parseProjects(registry)).toEqual([
      { name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: 'First project' },
      {
        name: 'Beta Program',
        slug: 'beta-program',
        path: 'projects/beta-program.md',
        summary: 'Second project'
      }
    ]);
  });

  it('preserves registry order', () => {
    expect(parseProjects(registry).map((project) => project.slug)).toEqual(['alpha', 'beta-program']);
  });

  it('is deterministic across repeated parses', () => {
    expect(parseProjects(registry)).toEqual(parseProjects(registry));
  });

  it('ignores headers, separators, prose, and rows without a project link', () => {
    const markdown = [
      'Some prose about the registry.',
      '| Project | Summary |',
      '| --- | --- |',
      '| Not a link | Ignored |',
      '| [Alpha](projects/alpha.md) | Kept |'
    ].join('\n');

    expect(parseProjects(markdown)).toEqual([
      { name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: 'Kept' }
    ]);
  });

  it('defaults a missing summary cell to an empty string', () => {
    expect(parseProjects('| [Alpha](projects/alpha.md) |')).toEqual([
      { name: 'Alpha', slug: 'alpha', path: 'projects/alpha.md', summary: '' }
    ]);
  });

  it('returns an empty list for a registry with no project rows', () => {
    expect(parseProjects('# Projects\n\nNothing registered yet.\n')).toEqual([]);
  });
});
