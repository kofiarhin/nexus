import { appError } from '../utils/errors.js';
import { archiveDestination, assertPathAllowed, isMarkdownPath, normalizeDirectoryPath, normalizeVaultPath } from '../utils/paths.js';
import { extractTitle } from '../utils/markdown.js';

/**
 * The single Vault access point (specification section 9).
 *
 * Every read and write in the application goes through this contract, so path
 * normalization and allowlist checks cannot be skipped by a caller. Writes are
 * revision-aware: a mutation without the current blob SHA is refused.
 */
export class VaultRepository {
  constructor({ githubClient, readPaths = [], writePaths = [], searchMaxFiles = 250 }) {
    this.githubClient = githubClient;
    this.readPaths = readPaths;
    this.writePaths = writePaths;
    this.searchMaxFiles = searchMaxFiles;
  }

  isConfigured() {
    return this.githubClient.isConfigured();
  }

  resolveReadPath(path) {
    return assertPathAllowed(normalizeVaultPath(path), this.readPaths, 'read');
  }

  resolveWritePath(path) {
    const normalized = assertPathAllowed(normalizeVaultPath(path), this.writePaths, 'write');
    // Reading back a written file is part of the mutation pipeline, so a
    // writable path must also be readable.
    return assertPathAllowed(normalized, this.readPaths, 'read');
  }

  async readText(path, ref) {
    const target = this.resolveReadPath(path);
    const file = await this.githubClient.readFile(target, ref);
    return {
      path: file.path,
      content: file.content,
      revision: file.sha,
      sha: file.sha,
      size: file.size,
      ref: file.ref,
      repository: file.repository,
      title: isMarkdownPath(file.path) ? extractTitle(file.content) : null
    };
  }

  /** Returns null instead of throwing when the file is absent. */
  async readTextIfExists(path, ref) {
    const target = this.resolveReadPath(path);
    const file = await this.githubClient.readFileIfExists(target, ref);
    if (!file) return null;
    return {
      path: file.path,
      content: file.content,
      revision: file.sha,
      sha: file.sha,
      size: file.size,
      ref: file.ref,
      repository: file.repository,
      title: isMarkdownPath(file.path) ? extractTitle(file.content) : null
    };
  }

  async readMetadata(path, ref) {
    const target = this.resolveReadPath(path);
    const metadata = await this.githubClient.readMetadata(target, ref);
    return { ...metadata, revision: metadata.sha };
  }

  async listDirectory(path, ref) {
    const target = normalizeDirectoryPath(path);
    if (target !== '') assertPathAllowed(target, this.readPaths, 'read');
    const entries = await this.githubClient.listDirectory(target, ref);
    // Root listings still hide anything outside the read allowlist.
    return entries.filter((entry) => this.canRead(entry.path));
  }

  canRead(path) {
    try {
      assertPathAllowed(normalizeVaultPath(path), this.readPaths, 'read');
      return true;
    } catch {
      return false;
    }
  }

  canWrite(path) {
    try {
      this.resolveWritePath(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Readable Markdown files as a flat list, used for the tree and search. */
  async listVaultFiles(ref) {
    const tree = await this.githubClient.listTree(ref);
    return {
      truncated: tree.truncated,
      entries: tree.entries.filter((entry) => entry.type === 'file' && this.canRead(entry.path))
    };
  }

  /**
   * Bounded repository-native text search (specification section 11).
   * Candidate files come from the git tree; only a capped number are read.
   */
  async searchText(query, { scope = '', limit = 20, ref } = {}) {
    const needle = String(query ?? '').trim();
    if (needle === '') {
      throw appError('VALIDATION_ERROR', 'A search query is required');
    }

    const scopePath = normalizeDirectoryPath(scope);
    const { entries, truncated } = await this.listVaultFiles(ref);

    const candidates = entries
      .filter((entry) => isMarkdownPath(entry.path))
      .filter((entry) => scopePath === '' || entry.path === scopePath || entry.path.startsWith(`${scopePath}/`))
      .slice(0, this.searchMaxFiles);

    const lowered = needle.toLowerCase();
    const results = [];

    for (const candidate of candidates) {
      if (results.length >= limit) break;
      // eslint-disable-next-line no-await-in-loop
      const file = await this.githubClient.readFileIfExists(candidate.path, ref);
      if (!file) continue;

      const lines = file.content.split('\n');
      const matches = [];
      lines.forEach((line, index) => {
        if (matches.length < 3 && line.toLowerCase().includes(lowered)) {
          matches.push({ line: index + 1, text: line.trim().slice(0, 240) });
        }
      });

      const titleMatch = String(extractTitle(file.content) ?? '').toLowerCase().includes(lowered);
      const pathMatch = candidate.path.toLowerCase().includes(lowered);

      if (matches.length === 0 && !titleMatch && !pathMatch) continue;

      results.push({
        path: candidate.path,
        revision: file.sha,
        sha: file.sha,
        title: extractTitle(file.content),
        matches,
        // Path and title hits rank above body hits so exact lookups win.
        score: (pathMatch ? 100 : 0) + (titleMatch ? 50 : 0) + matches.length
      });
    }

    return {
      query: needle,
      scope: scopePath,
      scanned: candidates.length,
      truncated: truncated || candidates.length >= this.searchMaxFiles,
      results: results.sort((a, b) => b.score - a.score).slice(0, limit)
    };
  }

  async createText(path, content, message) {
    const target = this.resolveWritePath(path);
    const existing = await this.githubClient.readFileIfExists(target);
    if (existing) {
      throw appError('VAULT_FILE_EXISTS', `A Vault file already exists at ${target}`, { path: target });
    }
    const result = await this.githubClient.createFile({ path: target, content, message });
    return { path: target, revision: result.sha, sha: result.sha, commit: result.commit };
  }

  async replaceText(path, content, expectedSha, message) {
    const target = this.resolveWritePath(path);
    if (!expectedSha) {
      throw appError('VALIDATION_ERROR', 'A current revision is required to replace a Vault file');
    }
    const result = await this.githubClient.updateFile({ path: target, content, sha: expectedSha, message });
    return { path: target, revision: result.sha, sha: result.sha, commit: result.commit };
  }

  async appendText(path, content, expectedSha, message) {
    return this.replaceText(path, content, expectedSha, message);
  }

  /**
   * Move is create-then-delete: GitHub's Contents API has no atomic rename.
   * The destination is written first so a failure never loses the source.
   */
  async movePath(from, to, expectedSha, message) {
    const source = this.resolveWritePath(from);
    const destination = this.resolveWritePath(to);

    if (source === destination) {
      throw appError('VALIDATION_ERROR', 'The move source and destination are identical');
    }

    const current = await this.githubClient.readFile(source);
    if (expectedSha && current.sha !== expectedSha) {
      throw appError('VAULT_CONFLICT', 'The Vault file changed since it was read', {
        path: source,
        expectedRevision: expectedSha,
        currentRevision: current.sha
      });
    }

    const existingDestination = await this.githubClient.readFileIfExists(destination);
    if (existingDestination) {
      throw appError('VAULT_FILE_EXISTS', `A Vault file already exists at ${destination}`, { path: destination });
    }

    const written = await this.githubClient.createFile({
      path: destination,
      content: current.content,
      message: message ?? `Move ${source} to ${destination}`
    });
    await this.githubClient.deleteFile({
      path: source,
      sha: current.sha,
      message: message ?? `Move ${source} to ${destination}`
    });

    return {
      path: destination,
      previousPath: source,
      revision: written.sha,
      sha: written.sha,
      commit: written.commit
    };
  }

  async archivePath(path, expectedSha, message, { now = new Date() } = {}) {
    const source = this.resolveWritePath(path);
    const destination = archiveDestination(source, now);
    return this.movePath(source, destination, expectedSha, message ?? `Archive ${source}`);
  }

  async deletePath(path, expectedSha, message) {
    const target = this.resolveWritePath(path);
    if (!expectedSha) {
      throw appError('VALIDATION_ERROR', 'A current revision is required to delete a Vault file');
    }
    const result = await this.githubClient.deleteFile({ path: target, sha: expectedSha, message });
    return { path: target, revision: null, sha: null, commit: result.commit };
  }

  async readHistory(path, limit = 20) {
    const target = this.resolveReadPath(path);
    const commits = await this.githubClient.listCommits(target, limit);
    return { path: target, revisions: commits };
  }

  /** Restores a previous commit's content as a new revision on the branch. */
  async restoreRevision(path, revision, expectedSha, message) {
    const target = this.resolveWritePath(path);
    const historical = await this.githubClient.readFile(target, revision);
    return this.replaceText(
      target,
      historical.content,
      expectedSha,
      message ?? `Restore ${target} to ${revision.slice(0, 7)}`
    );
  }
}
