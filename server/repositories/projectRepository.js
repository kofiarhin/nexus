import { VAULT_PATHS } from '../config/policy.js';
import {
  extractTitle,
  findSection,
  parseFrontMatter,
  parseListItems,
  parseSections
} from '../utils/markdown.js';

const LINKED_CELL_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/;
const PROJECT_PATH_PATTERN = /^[^\s|]+\.md$/i;
const SEPARATOR_ROW_PATTERN = /^[\s|:-]+$/;

// Registry rows are split manually so that leading/trailing pipes are optional
// and empty interior cells (an omitted status, for example) are preserved.
function splitRow(line) {
  const cells = line.trim().split('|').map((cell) => cell.trim());
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// projects/nexus/INDEX.md -> nexus, projects/brain.md -> brain.
function slugFromPath(path) {
  const segments = path.replace(/\.md$/i, '').split('/').filter(Boolean);
  if (segments[segments.length - 1]?.toUpperCase() === 'INDEX') segments.pop();
  return segments[segments.length - 1] ?? '';
}

function buildProject({ id, name, path, summary, status = '', updatedAt = '' }) {
  if (!PROJECT_PATH_PATTERN.test(path)) return null;

  const slug = id || slugFromPath(path);
  if (!slug) return null;

  return { name: name || slug, slug, path, summary, status, updatedAt };
}

// Legacy format: | [Nexus](projects/nexus/INDEX.md) | AI-native productivity system |
function parseLinkedRow(cells) {
  const match = cells[0].match(LINKED_CELL_PATTERN);
  if (!match) return null;

  return buildProject({
    id: '',
    name: match[1],
    path: match[2],
    summary: cells[1] ?? ''
  });
}

// Structured Vault format: | ID | Name | Status | Path | Updated |
// The path column is located by value rather than by header so that both table
// layouts can be interleaved in a single registry file.
function parseStructuredRow(cells) {
  const pathIndex = cells.findIndex((cell) => PROJECT_PATH_PATTERN.test(cell));
  if (pathIndex === -1) return null;

  const isFullRow = pathIndex >= 3;
  const status = isFullRow ? cells[2] : '';
  let name = '';
  if (isFullRow) name = cells[1];
  else if (pathIndex >= 1) name = cells[0];

  return buildProject({
    id: isFullRow ? cells[0] : '',
    name,
    path: cells[pathIndex],
    summary: status ? `Status: ${status}` : '',
    status,
    updatedAt: cells[pathIndex + 1] ?? ''
  });
}

/** Registry rows with their status and updated columns retained. */
function parseProjectRows(markdown) {
  return (markdown ?? '')
    .split('\n')
    .filter((line) => line.trim().startsWith('|') && !SEPARATOR_ROW_PATTERN.test(line))
    .map((line) => {
      const cells = splitRow(line);
      if (cells.length === 0) return null;
      return parseLinkedRow(cells) ?? parseStructuredRow(cells);
    })
    .filter(Boolean);
}

/**
 * The registry projection used by `GET /projects`. Kept to its original four
 * fields so existing Vault consumers and clients are unaffected.
 */
function parseProjects(markdown) {
  return parseProjectRows(markdown).map(({ name, slug, path, summary }) => ({
    name,
    slug,
    path,
    summary
  }));
}

export class ProjectRepository {
  constructor({ vaultRepository }) {
    this.vaultRepository = vaultRepository;
  }

  async list() {
    const file = await this.vaultRepository.readText(VAULT_PATHS.projectRegistry);
    return parseProjects(file.content);
  }

  async listDetailed() {
    const file = await this.vaultRepository.readText(VAULT_PATHS.projectRegistry);
    return {
      revision: file.revision,
      sourcePath: file.path,
      projects: parseProjectRows(file.content)
    };
  }

  async findEntry(projectId) {
    const { projects, sourcePath, revision } = await this.listDetailed();
    const entry = projects.find((project) => project.slug === projectId);
    return entry ? { entry, sourcePath, revision } : { entry: null, sourcePath, revision };
  }

  /**
   * Full project record: registry row plus the project document's front matter
   * and named sections. A missing document still yields the registry data.
   */
  async get(projectId) {
    const { entry, sourcePath, revision } = await this.findEntry(projectId);
    if (!entry) return null;

    const document = await this.vaultRepository.readTextIfExists(entry.path);
    const sources = [
      { path: sourcePath, sha: revision, title: 'Project registry', reason: 'Registry entry for this project' }
    ];

    if (!document) {
      return {
        id: entry.slug,
        name: entry.name,
        lifecycle: entry.status || 'unknown',
        summary: entry.summary,
        path: entry.path,
        documentMissing: true,
        currentState: '',
        currentFocus: '',
        roadmap: [],
        decisions: [],
        assumptions: [],
        openQuestions: [],
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
      reason: 'Project document'
    });

    return {
      id: entry.slug,
      name: data.name ?? extractTitle(body) ?? entry.name,
      lifecycle: data.lifecycle ?? data.status ?? entry.status ?? 'unknown',
      summary: entry.summary,
      path: document.path,
      documentMissing: false,
      currentState: findSection(sections, 'current state', 'state', 'snapshot'),
      currentFocus: findSection(sections, 'current focus', 'focus'),
      roadmap: parseListItems(findSection(sections, 'roadmap', 'milestones')),
      decisions: parseListItems(findSection(sections, 'decisions')),
      assumptions: parseListItems(findSection(sections, 'assumptions')),
      openQuestions: parseListItems(findSection(sections, 'open questions', 'questions')),
      documents: parseListItems(findSection(sections, 'documents')),
      sections: sections.map(({ heading, level, body: sectionBody }) => ({ heading, level, body: sectionBody })),
      updatedAt: data.updatedAt ?? entry.updatedAt ?? null,
      revision: document.revision,
      sources
    };
  }
}

export { parseProjects, parseProjectRows };
