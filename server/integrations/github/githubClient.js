import { appError } from '../../utils/errors.js';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';

function decodeContent(body) {
  if (!body || typeof body.content !== 'string') {
    throw appError('VAULT_UPSTREAM_ERROR', 'GitHub Vault returned an invalid response');
  }

  const content = body.content.replace(/\s/g, '');
  const isValidBase64 = content.length === 0
    || (content.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(content));

  if (!isValidBase64) {
    throw appError('VAULT_UPSTREAM_ERROR', 'GitHub Vault returned invalid file content');
  }

  return Buffer.from(content, 'base64').toString('utf8');
}

const encode = (text) => Buffer.from(text ?? '', 'utf8').toString('base64');

/**
 * GitHub Contents/Git API client for the Nexus Vault.
 *
 * Every failure is normalized to a Vault error code before leaving this module
 * so upstream payloads, tokens, and rate-limit details never reach a response.
 */
export class GitHubClient {
  constructor({ token, owner, repo, branch, fetchImpl = fetch } = {}) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.token && this.owner && this.repo);
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw appError('VAULT_NOT_CONFIGURED', 'GitHub Vault is not configured');
    }
  }

  get repositoryName() {
    return this.owner && this.repo ? `${this.owner}/${this.repo}` : null;
  }

  async request(path, { method = 'GET', body, notFoundMessage, allowNotFound = false } = {}) {
    this.assertConfigured();

    let response;
    try {
      response = await this.fetch(`${API_ROOT}${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': API_VERSION,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
    } catch {
      throw appError('VAULT_UPSTREAM_ERROR', 'GitHub Vault request failed');
    }

    if (response.status === 404) {
      if (allowNotFound) return null;
      throw appError('VAULT_FILE_NOT_FOUND', notFoundMessage ?? 'Vault resource not found');
    }

    if (response.status === 409) {
      throw appError('VAULT_CONFLICT', 'The Vault file changed since it was read');
    }

    if (response.status === 422) {
      // GitHub reports both "sha mismatch" and "file already exists" as 422.
      let detail = '';
      try {
        const payload = await response.json();
        detail = String(payload?.message ?? '');
      } catch {
        detail = '';
      }
      if (/sha/i.test(detail)) {
        throw appError('VAULT_CONFLICT', 'The Vault file changed since it was read');
      }
      if (/exists/i.test(detail)) {
        throw appError('VAULT_FILE_EXISTS', 'A Vault file already exists at that path');
      }
      throw appError('VAULT_UPSTREAM_ERROR', 'GitHub Vault rejected the request');
    }

    if (!response.ok) {
      throw appError('VAULT_UPSTREAM_ERROR', 'GitHub Vault request failed');
    }

    if (response.status === 204) return null;

    try {
      return await response.json();
    } catch {
      throw appError('VAULT_UPSTREAM_ERROR', 'GitHub Vault returned an invalid response');
    }
  }

  contentsPath(path, ref) {
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    const reference = ref ?? this.branch;
    return `/repos/${this.owner}/${this.repo}/contents/${encoded}?ref=${encodeURIComponent(reference)}`;
  }

  /** Backwards-compatible read used by the project registry parser. */
  async readText(path) {
    const body = await this.request(this.contentsPath(path), {
      notFoundMessage: `Vault file not found: ${path}`
    });
    return decodeContent(body);
  }

  async readFile(path, ref) {
    const body = await this.request(this.contentsPath(path, ref), {
      notFoundMessage: `Vault file not found: ${path}`
    });

    if (Array.isArray(body)) {
      throw appError('VALIDATION_ERROR', `Vault path is a directory, not a file: ${path}`);
    }

    return {
      path,
      content: decodeContent(body),
      sha: body.sha ?? null,
      size: body.size ?? null,
      ref: ref ?? this.branch,
      repository: this.repositoryName
    };
  }

  async readFileIfExists(path, ref) {
    const body = await this.request(this.contentsPath(path, ref), { allowNotFound: true });
    if (body === null || Array.isArray(body)) return null;
    return {
      path,
      content: decodeContent(body),
      sha: body.sha ?? null,
      size: body.size ?? null,
      ref: ref ?? this.branch,
      repository: this.repositoryName
    };
  }

  async readMetadata(path, ref) {
    const body = await this.request(this.contentsPath(path, ref), {
      notFoundMessage: `Vault file not found: ${path}`
    });
    if (Array.isArray(body)) {
      return { path, type: 'dir', sha: null, size: null, entries: body.length, repository: this.repositoryName };
    }
    return {
      path,
      type: 'file',
      sha: body.sha ?? null,
      size: body.size ?? null,
      ref: ref ?? this.branch,
      repository: this.repositoryName
    };
  }

  async listDirectory(path, ref) {
    const target = path === '' || path === undefined ? '' : path;
    const encoded = target === '' ? '' : String(target).split('/').map(encodeURIComponent).join('/');
    const reference = ref ?? this.branch;
    const body = await this.request(
      `/repos/${this.owner}/${this.repo}/contents/${encoded}?ref=${encodeURIComponent(reference)}`,
      { notFoundMessage: `Vault directory not found: ${target || '/'}` }
    );

    if (!Array.isArray(body)) {
      throw appError('VALIDATION_ERROR', `Vault path is a file, not a directory: ${target}`);
    }

    return body.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type === 'dir' ? 'dir' : 'file',
      sha: entry.sha ?? null,
      size: entry.size ?? null
    }));
  }

  /** Recursive tree listing, used for the document tree and bounded search. */
  async listTree(ref) {
    const reference = encodeURIComponent(ref ?? this.branch);
    const body = await this.request(
      `/repos/${this.owner}/${this.repo}/git/trees/${reference}?recursive=1`,
      { notFoundMessage: 'Vault branch not found' }
    );

    const entries = Array.isArray(body?.tree) ? body.tree : [];
    return {
      truncated: Boolean(body?.truncated),
      entries: entries.map((entry) => ({
        path: entry.path,
        type: entry.type === 'tree' ? 'dir' : 'file',
        sha: entry.sha ?? null,
        size: entry.size ?? null
      }))
    };
  }

  async createFile({ path, content, message }) {
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    const body = await this.request(`/repos/${this.owner}/${this.repo}/contents/${encoded}`, {
      method: 'PUT',
      body: { message, content: encode(content), branch: this.branch }
    });
    return this.#writeResult(path, body);
  }

  async updateFile({ path, content, sha, message }) {
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    const body = await this.request(`/repos/${this.owner}/${this.repo}/contents/${encoded}`, {
      method: 'PUT',
      body: { message, content: encode(content), sha, branch: this.branch }
    });
    return this.#writeResult(path, body);
  }

  async deleteFile({ path, sha, message }) {
    const encoded = String(path).split('/').map(encodeURIComponent).join('/');
    const body = await this.request(`/repos/${this.owner}/${this.repo}/contents/${encoded}`, {
      method: 'DELETE',
      body: { message, sha, branch: this.branch }
    });
    return {
      path,
      sha: null,
      commit: body?.commit?.sha ?? null,
      repository: this.repositoryName
    };
  }

  async listCommits(path, limit = 20) {
    const query = new URLSearchParams({
      path,
      sha: this.branch,
      per_page: String(Math.min(Math.max(limit, 1), 100))
    });
    const body = await this.request(
      `/repos/${this.owner}/${this.repo}/commits?${query.toString()}`,
      { notFoundMessage: `Vault history not found: ${path}` }
    );

    if (!Array.isArray(body)) {
      throw appError('VAULT_UPSTREAM_ERROR', 'GitHub Vault returned an invalid history response');
    }

    return body.map((commit) => ({
      revision: commit.sha,
      message: commit.commit?.message ?? '',
      author: commit.commit?.author?.name ?? null,
      date: commit.commit?.author?.date ?? null,
      url: commit.html_url ?? null
    }));
  }

  #writeResult(path, body) {
    return {
      path,
      sha: body?.content?.sha ?? null,
      commit: body?.commit?.sha ?? null,
      repository: this.repositoryName
    };
  }
}

export { decodeContent };
