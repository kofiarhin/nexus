import { VAULT_PATHS } from '../config/policy.js';
import {
  extractTitle,
  findSection,
  parseFrontMatter,
  parseLinkCell,
  parseListItems,
  parseSections,
  parseTableRows
} from '../utils/markdown.js';

const DOCUMENT_PATH_PATTERN = /^[^\s|]+\.md$/i;

function slugFromPath(path) {
  const segments = path.replace(/\.md$/i, '').split('/').filter(Boolean);
  const last = segments[segments.length - 1]?.toUpperCase();
  if (last === 'INDEX' || last === 'BUSINESS') segments.pop();
  return segments[segments.length - 1] ?? '';
}

/**
 * Business registry parsing.
 *
 * Accepts the same two table shapes as the project registry so an existing
 * Vault needs no migration: a linked cell, or ID/Name/Status/Path columns.
 */
export function parseBusinesses(markdown) {
  return parseTableRows(markdown)
    .map((cells) => {
      const linked = parseLinkCell(cells[0]);
      if (linked.path && DOCUMENT_PATH_PATTERN.test(linked.path)) {
        const slug = slugFromPath(linked.path);
        if (!slug) return null;
        return {
          id: slug,
          name: linked.text || slug,
          status: '',
          path: linked.path,
          summary: cells[1] ?? '',
          updatedAt: ''
        };
      }

      const pathIndex = cells.findIndex((cell) => DOCUMENT_PATH_PATTERN.test(cell));
      if (pathIndex === -1) return null;

      const isFullRow = pathIndex >= 3;
      const id = isFullRow ? cells[0] : '';
      const slug = id || slugFromPath(cells[pathIndex]);
      if (!slug) return null;

      const name = isFullRow ? cells[1] : pathIndex >= 1 ? cells[0] : '';
      const status = isFullRow ? cells[2] : '';

      return {
        id: slug,
        name: name || slug,
        status,
        path: cells[pathIndex],
        summary: status ? `Status: ${status}` : '',
        updatedAt: cells[pathIndex + 1] ?? ''
      };
    })
    .filter(Boolean);
}

export class BusinessRepository {
  constructor({ vaultRepository }) {
    this.vaultRepository = vaultRepository;
  }

  /** A missing registry yields an empty list rather than an error. */
  async list() {
    const file = await this.vaultRepository.readTextIfExists(VAULT_PATHS.businessRegistry);
    if (!file) {
      return { businesses: [], sourcePath: VAULT_PATHS.businessRegistry, revision: null, registered: false };
    }
    return {
      businesses: parseBusinesses(file.content),
      sourcePath: file.path,
      revision: file.revision,
      registered: true
    };
  }

  async get(businessId) {
    const { businesses, sourcePath, revision } = await this.list();
    const entry = businesses.find((business) => business.id === businessId);
    if (!entry) return null;

    const sources = [
      { path: sourcePath, sha: revision, title: 'Business registry', reason: 'Registry entry for this business' }
    ];

    const document = await this.vaultRepository.readTextIfExists(entry.path);
    if (!document) {
      return {
        id: entry.id,
        name: entry.name,
        status: entry.status || 'unknown',
        path: entry.path,
        documentMissing: true,
        purpose: '',
        goals: [],
        products: [],
        strategy: '',
        metrics: [],
        risks: [],
        blockers: [],
        people: [],
        sections: [],
        updatedAt: entry.updatedAt || null,
        revision: null,
        sources
      };
    }

    const { data, body } = parseFrontMatter(document.content);
    const sections = parseSections(body);

    sources.push({
      path: document.path,
      sha: document.revision,
      title: extractTitle(body) ?? entry.name,
      reason: 'Business document'
    });

    return {
      id: entry.id,
      name: data.name ?? extractTitle(body) ?? entry.name,
      status: data.status ?? entry.status ?? 'unknown',
      path: document.path,
      documentMissing: false,
      purpose: findSection(sections, 'purpose', 'mission'),
      goals: parseListItems(findSection(sections, 'goals', 'objectives')),
      products: parseListItems(findSection(sections, 'products', 'products and services', 'services')),
      strategy: findSection(sections, 'strategy'),
      audience: findSection(sections, 'audience', 'customers'),
      metrics: parseListItems(findSection(sections, 'metrics', 'key metrics')),
      risks: parseListItems(findSection(sections, 'risks')),
      blockers: parseListItems(findSection(sections, 'blockers')),
      people: parseListItems(findSection(sections, 'people', 'relationships')),
      procedures: parseListItems(findSection(sections, 'procedures', 'operating procedures')),
      sections: sections.map(({ heading, level, body: sectionBody }) => ({ heading, level, body: sectionBody })),
      updatedAt: data.updatedAt ?? entry.updatedAt ?? null,
      revision: document.revision,
      sources
    };
  }
}
