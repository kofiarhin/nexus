import { describe, expect, it } from 'vitest';
import {
  archiveDestination,
  assertPathAllowed,
  isPathAllowed,
  normalizeDirectoryPath,
  normalizeVaultPath
} from '../../server/utils/paths.js';

describe('normalizeVaultPath', () => {
  it('normalizes redundant separators and current-directory segments', () => {
    expect(normalizeVaultPath('projects//nexus/./PROJECT.md')).toBe('projects/nexus/PROJECT.md');
  });

  it('rejects parent-directory traversal', () => {
    expect(() => normalizeVaultPath('projects/../../etc/passwd')).toThrow(/traversal/i);
    expect(() => normalizeVaultPath('../secrets.md')).toThrow(/traversal/i);
  });

  it('rejects absolute and drive-qualified paths', () => {
    expect(() => normalizeVaultPath('/etc/passwd')).toThrow(/repository-relative/i);
    expect(() => normalizeVaultPath('C:/Windows/system.ini')).toThrow(/repository-relative/i);
  });

  it('rejects backslashes and unsupported characters', () => {
    expect(() => normalizeVaultPath('projects\\nexus.md')).toThrow(/unsupported/i);
    expect(() => normalizeVaultPath('projects/nex us.md')).toThrow(/not permitted/i);
    expect(() => normalizeVaultPath('projects/$(whoami).md')).toThrow(/not permitted/i);
  });

  it('rejects empty and over-long paths', () => {
    expect(() => normalizeVaultPath('')).toThrow(/required/i);
    expect(() => normalizeVaultPath('   ')).toThrow(/required/i);
    expect(() => normalizeVaultPath(`${'a'.repeat(401)}.md`)).toThrow(/too long/i);
  });

  it('treats the Vault root as an empty directory path', () => {
    expect(normalizeDirectoryPath('')).toBe('');
    expect(normalizeDirectoryPath('/')).toBe('');
    expect(normalizeDirectoryPath('projects/')).toBe('projects');
  });
});

describe('assertPathAllowed', () => {
  const allowlist = ['projects', 'registry'];

  it('allows exact and nested matches', () => {
    expect(assertPathAllowed('projects/nexus/PROJECT.md', allowlist)).toBe('projects/nexus/PROJECT.md');
    expect(isPathAllowed('registry/PROJECTS.md', allowlist)).toBe(true);
  });

  it('rejects paths outside the allowlist', () => {
    expect(() => assertPathAllowed('secrets/keys.md', allowlist, 'read')).toThrow(/not allowed for read/i);
    expect(isPathAllowed('secrets/keys.md', allowlist)).toBe(false);
  });

  it('does not treat a shared name prefix as a nested path', () => {
    expect(isPathAllowed('projects-private/secret.md', allowlist)).toBe(false);
  });

  it('rejects everything when the allowlist is empty', () => {
    expect(() => assertPathAllowed('projects/nexus.md', [], 'write')).toThrow(/no vault paths/i);
  });
});

describe('archiveDestination', () => {
  it('moves a file under archive/ with a date stamp', () => {
    expect(archiveDestination('projects/nexus/PROJECT.md', new Date('2026-07-31T00:00:00Z')))
      .toBe('archive/projects/nexus/PROJECT.2026-07-31.md');
  });

  it('handles a root-level file', () => {
    expect(archiveDestination('NEXUS.md', new Date('2026-07-31T00:00:00Z'))).toBe('archive/NEXUS.2026-07-31.md');
  });
});
