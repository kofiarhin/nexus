import { normalizeDirectoryPath } from '../utils/paths.js';

/**
 * Document browsing and reading.
 *
 * All document mutations go through the operation service; this service owns
 * only deterministic reads, the Vault tree, and revision history.
 */
export class DocumentService {
  constructor({ vaultRepository }) {
    this.vaultRepository = vaultRepository;
  }

  async read(path, ref) {
    const file = await this.vaultRepository.readText(path, ref);
    return {
      ...file,
      writable: this.vaultRepository.canWrite(file.path),
      sources: [{ path: file.path, sha: file.revision, title: file.title, reason: 'Requested document' }]
    };
  }

  async metadata(path, ref) {
    return this.vaultRepository.readMetadata(path, ref);
  }

  async history(path, limit = 20) {
    return this.vaultRepository.readHistory(path, limit);
  }

  /**
   * Builds a nested tree from the flat git tree listing, bounded by depth so a
   * large Vault cannot produce an unbounded response.
   */
  async tree({ path = '', depth = 3 } = {}) {
    const root = normalizeDirectoryPath(path);
    const { entries, truncated } = await this.vaultRepository.listVaultFiles();

    const scoped = entries.filter(
      (entry) => root === '' || entry.path === root || entry.path.startsWith(`${root}/`)
    );

    const nodes = new Map();
    const children = new Map();

    const ensureDirectory = (directoryPath) => {
      if (directoryPath === '' || nodes.has(directoryPath)) return;
      nodes.set(directoryPath, {
        path: directoryPath,
        name: directoryPath.split('/').pop(),
        type: 'dir'
      });
      const parent = directoryPath.split('/').slice(0, -1).join('/');
      ensureDirectory(parent);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(directoryPath);
    };

    for (const entry of scoped) {
      const relative = root === '' ? entry.path : entry.path.slice(root.length + 1);
      if (relative.split('/').length > depth) continue;

      const parent = entry.path.split('/').slice(0, -1).join('/');
      ensureDirectory(parent);
      nodes.set(entry.path, {
        path: entry.path,
        name: entry.path.split('/').pop(),
        type: 'file',
        revision: entry.sha,
        size: entry.size,
        writable: this.vaultRepository.canWrite(entry.path)
      });
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(entry.path);
    }

    const build = (parent) => (children.get(parent) ?? [])
      .map((childPath) => nodes.get(childPath))
      .filter(Boolean)
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
      .map((node) => (node.type === 'dir' ? { ...node, children: build(node.path) } : node));

    return { path: root, truncated, entries: build(root) };
  }

  async listDirectory(path) {
    return this.vaultRepository.listDirectory(path);
  }
}
