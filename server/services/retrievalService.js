import { VAULT_PATHS } from '../config/policy.js';
import { appError } from '../utils/errors.js';
import { normalizeVaultPath } from '../utils/paths.js';

/**
 * Deterministic retrieval and context assembly (specification sections 10–11).
 *
 * Selection is entirely rule-based: the scope decides which documents load, and
 * the resulting manifest is what the reasoning provider is allowed to see. The
 * whole Vault is never loaded.
 */
export class RetrievalService {
  constructor({ vaultRepository, projectRepository, businessRepository, taskRepository, env }) {
    this.vaultRepository = vaultRepository;
    this.projectRepository = projectRepository;
    this.businessRepository = businessRepository;
    this.taskRepository = taskRepository;
    this.maxSources = env.contextMaxSources;
    this.maxCharacters = env.contextMaxCharacters;
  }

  async #readSource(path, reason) {
    const file = await this.vaultRepository.readTextIfExists(path);
    if (!file) return null;
    return {
      path: file.path,
      sha: file.revision,
      title: file.title ?? file.path.split('/').pop(),
      reason,
      content: file.content
    };
  }

  async workspaceRules() {
    const file = await this.vaultRepository.readTextIfExists(VAULT_PATHS.workspaceRules);
    return file?.content ?? '';
  }

  /**
   * Builds a bounded context manifest for a conversation scope.
   * Sources are truncated to fit the character budget; every entry records why
   * it was retrieved.
   */
  async buildContext({ scope = { type: 'vault', ids: [] }, query = '' } = {}) {
    const candidates = [];

    const push = (source) => {
      if (source) candidates.push(source);
    };

    if (scope.type === 'document') {
      for (const id of scope.ids ?? []) {
        // eslint-disable-next-line no-await-in-loop
        const source = await this.#readSource(normalizeVaultPath(id), 'Explicitly selected document');
        if (!source) throw appError('VAULT_FILE_NOT_FOUND', `Vault file not found: ${id}`);
        push(source);
      }
    }

    if (scope.type === 'project') {
      for (const id of scope.ids ?? []) {
        // eslint-disable-next-line no-await-in-loop
        const project = await this.projectRepository.get(id).catch(() => null);
        if (!project) continue;
        // eslint-disable-next-line no-await-in-loop
        push(await this.#readSource(project.path, 'Current project state'));
        const directory = project.path.split('/').slice(0, -1).join('/');
        if (directory) {
          // eslint-disable-next-line no-await-in-loop
          push(await this.#readSource(`${directory}/TASKS.md`, 'Project task records'));
        }
      }
    }

    if (scope.type === 'business') {
      for (const id of scope.ids ?? []) {
        // eslint-disable-next-line no-await-in-loop
        const business = await this.businessRepository.get(id).catch(() => null);
        if (!business) continue;
        // eslint-disable-next-line no-await-in-loop
        push(await this.#readSource(business.path, 'Current business state'));
      }
    }

    if (scope.type === 'custom') {
      for (const id of scope.ids ?? []) {
        // eslint-disable-next-line no-await-in-loop
        push(await this.#readSource(normalizeVaultPath(id), 'Manually selected context'));
      }
    }

    if (scope.type === 'vault') {
      push(await this.#readSource(VAULT_PATHS.projectRegistry, 'Project registry'));
      push(await this.#readSource(VAULT_PATHS.businessRegistry, 'Business registry'));
      push(await this.#readSource(VAULT_PATHS.taskFile, 'Task records'));
      push(await this.#readSource(VAULT_PATHS.memoryFile, 'Approved long-term memory'));

      // A whole-Vault scope adds only the highest-scoring search hits, never
      // the entire repository.
      if (query.trim()) {
        const search = await this.vaultRepository
          .searchText(query, { limit: 4 })
          .catch(() => ({ results: [] }));
        for (const result of search.results) {
          if (candidates.some((candidate) => candidate.path === result.path)) continue;
          // eslint-disable-next-line no-await-in-loop
          push(await this.#readSource(result.path, `Matched the request text "${query.slice(0, 60)}"`));
        }
      }
    }

    return this.#bound(candidates);
  }

  #bound(candidates) {
    const manifest = [];
    let used = 0;

    for (const candidate of candidates.slice(0, this.maxSources)) {
      const remaining = this.maxCharacters - used;
      if (remaining <= 0) break;
      const excerpt = candidate.content.length > remaining
        ? `${candidate.content.slice(0, remaining)}\n[truncated]`
        : candidate.content;
      used += excerpt.length;
      manifest.push({
        path: candidate.path,
        sha: candidate.sha,
        title: candidate.title,
        reason: candidate.reason,
        excerpt,
        truncated: excerpt.length < candidate.content.length
      });
    }

    return {
      sources: manifest,
      characters: used,
      truncated: candidates.length > manifest.length,
      omitted: Math.max(candidates.length - manifest.length, 0)
    };
  }

  /** The manifest shape returned to clients: excerpts are not included. */
  static toManifest(context) {
    return context.sources.map(({ path, sha, title, reason, truncated }) => ({
      path,
      sha,
      title,
      reason,
      truncated
    }));
  }
}

export class SearchService {
  constructor({ vaultRepository, projectRepository, businessRepository, env }) {
    this.vaultRepository = vaultRepository;
    this.projectRepository = projectRepository;
    this.businessRepository = businessRepository;
    this.maxResults = env.searchMaxResults;
  }

  /**
   * Layered search: exact path, then registry entries, then bounded text.
   * Results are usable without invoking the reasoning provider.
   */
  async search({ q, scope = '', limit = 20 }) {
    const bounded = Math.min(Math.max(limit, 1), this.maxResults);
    const layers = [];
    const seen = new Set();
    const results = [];

    const add = (record, layer) => {
      if (seen.has(record.path)) return;
      seen.add(record.path);
      results.push({ ...record, layer });
    };

    // 1. Exact path resolution.
    if (/\.md$/i.test(q.trim())) {
      const file = await this.vaultRepository.readTextIfExists(q.trim()).catch(() => null);
      if (file) {
        layers.push('exact-path');
        add(
          { path: file.path, revision: file.revision, title: file.title, matches: [], reason: 'Exact path match' },
          'exact-path'
        );
      }
    }

    // 2. Registry lookup.
    const needle = q.trim().toLowerCase();
    const projects = await this.projectRepository.list().catch(() => []);
    for (const project of projects) {
      if (project.name.toLowerCase().includes(needle) || project.slug.includes(needle)) {
        if (!layers.includes('registry')) layers.push('registry');
        add(
          {
            path: project.path,
            revision: null,
            title: project.name,
            matches: [],
            reason: 'Registered project name match',
            entity: { type: 'project', id: project.slug }
          },
          'registry'
        );
      }
    }

    const { businesses } = await this.businessRepository.list().catch(() => ({ businesses: [] }));
    for (const business of businesses) {
      if (business.name.toLowerCase().includes(needle) || business.id.includes(needle)) {
        if (!layers.includes('registry')) layers.push('registry');
        add(
          {
            path: business.path,
            revision: null,
            title: business.name,
            matches: [],
            reason: 'Registered business name match',
            entity: { type: 'business', id: business.id }
          },
          'registry'
        );
      }
    }

    // 3. Bounded repository-native text search.
    const text = await this.vaultRepository.searchText(q, { scope, limit: bounded });
    if (text.results.length > 0) layers.push('text');
    for (const result of text.results) {
      add(
        {
          path: result.path,
          revision: result.revision,
          title: result.title,
          matches: result.matches,
          reason: 'Matched document text'
        },
        'text'
      );
    }

    return {
      query: q,
      scope: text.scope,
      layers,
      scanned: text.scanned,
      truncated: text.truncated,
      results: results.slice(0, bounded)
    };
  }
}
