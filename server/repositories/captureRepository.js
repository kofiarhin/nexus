import { INBOX_KINDS, VAULT_PATHS } from '../config/policy.js';
import { derivedId } from '../utils/ids.js';
import {
  extractTitle,
  findSection,
  parseAnnotatedListItems,
  parseFrontMatter,
  parseListItems,
  parseSections,
  serializeAnnotations
} from '../utils/markdown.js';

/** Inbox entries are annotated bullets in a single capture file. */
export function parseInboxEntries(markdown, sourcePath) {
  return parseAnnotatedListItems(markdown).map((item) => {
    const annotations = item.annotations ?? {};
    const kind = INBOX_KINDS.includes(String(annotations.kind ?? '').toLowerCase())
      ? String(annotations.kind).toLowerCase()
      : 'unclassified';

    return {
      id: annotations.id || derivedId('inb', sourcePath, item.text),
      content: item.text,
      kind,
      capturedAt: annotations.captured || null,
      status: annotations.status === 'promoted' ? 'promoted' : 'open',
      promotedTo: annotations.promoted || null,
      sourcePath,
      sourceLine: item.line
    };
  });
}

export function serializeInboxEntry(entry) {
  const suffix = serializeAnnotations({
    id: entry.id,
    kind: entry.kind,
    captured: entry.capturedAt ?? '',
    status: entry.status === 'promoted' ? 'promoted' : '',
    promoted: entry.promotedTo ?? ''
  });
  return `- ${entry.content}${suffix ? ` ${suffix}` : ''}`;
}

export class InboxRepository {
  constructor({ vaultRepository, inboxPath = VAULT_PATHS.inboxFile }) {
    this.vaultRepository = vaultRepository;
    this.inboxPath = inboxPath;
  }

  async readFile() {
    const file = await this.vaultRepository.readTextIfExists(this.inboxPath);
    return file ?? { path: this.inboxPath, content: '', revision: null, missing: true };
  }

  async list() {
    const file = await this.readFile();
    return {
      path: file.path,
      revision: file.revision ?? null,
      entries: parseInboxEntries(file.content, file.path)
    };
  }

  async get(entryId) {
    const { entries, path, revision } = await this.list();
    const entry = entries.find((candidate) => candidate.id === entryId);
    return entry ? { entry, path, revision } : null;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const dailyNotePath = (date) => `${VAULT_PATHS.dailyDirectory}/${date}.md`;

/** Daily notes: one Markdown file per day with conventional sections. */
export class DailyRepository {
  constructor({ vaultRepository }) {
    this.vaultRepository = vaultRepository;
  }

  async list(limit = 30) {
    const entries = await this.vaultRepository
      .listDirectory(VAULT_PATHS.dailyDirectory)
      .catch((error) => {
        if (error?.code === 'VAULT_FILE_NOT_FOUND') return [];
        throw error;
      });

    return entries
      .filter((entry) => entry.type === 'file' && DATE_PATTERN.test(entry.name.replace(/\.md$/i, '')))
      .map((entry) => ({ date: entry.name.replace(/\.md$/i, ''), path: entry.path, revision: entry.sha }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
  }

  async get(date) {
    const file = await this.vaultRepository.readTextIfExists(dailyNotePath(date));
    if (!file) return { date, path: dailyNotePath(date), exists: false, revision: null, sections: [] };

    const { data, body } = parseFrontMatter(file.content);
    const sections = parseSections(body);

    return {
      date,
      path: file.path,
      exists: true,
      revision: file.revision,
      title: extractTitle(body),
      plan: parseListItems(findSection(sections, 'plan', 'priorities')),
      notes: findSection(sections, 'notes'),
      events: parseListItems(findSection(sections, 'events')),
      outcomes: parseListItems(findSection(sections, 'outcomes', 'results')),
      reflections: findSection(sections, 'reflections', 'reflection'),
      metadata: data,
      sections: sections.map(({ heading, level, body: sectionBody }) => ({ heading, level, body: sectionBody })),
      content: file.content
    };
  }
}

/** Knowledge notes: any Markdown document under the knowledge directory. */
export class KnowledgeRepository {
  constructor({ vaultRepository }) {
    this.vaultRepository = vaultRepository;
  }

  async list() {
    const { entries } = await this.vaultRepository.listVaultFiles();
    return entries
      .filter((entry) => entry.path.startsWith(`${VAULT_PATHS.knowledgeDirectory}/`) && /\.md$/i.test(entry.path))
      .map((entry) => ({
        path: entry.path,
        name: entry.path.split('/').pop().replace(/\.md$/i, ''),
        revision: entry.sha,
        size: entry.size
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async get(path) {
    const file = await this.vaultRepository.readText(path);
    const { data, body } = parseFrontMatter(file.content);
    const sections = parseSections(body);

    // Wiki-style links and Markdown links are surfaced as outgoing references.
    const links = [
      ...new Set([
        ...[...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim()),
        ...[...body.matchAll(/\[[^\]]*\]\(([^)]+\.md)\)/g)].map((match) => match[1].trim())
      ])
    ];

    return {
      path: file.path,
      title: extractTitle(body) ?? file.path.split('/').pop(),
      revision: file.revision,
      metadata: data,
      tags: Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : [],
      links,
      sections: sections.map(({ heading, level, body: sectionBody }) => ({ heading, level, body: sectionBody })),
      content: file.content
    };
  }
}
