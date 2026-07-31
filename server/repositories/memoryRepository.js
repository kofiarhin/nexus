import { MEMORY_TYPES, VAULT_PATHS } from '../config/policy.js';
import { derivedId } from '../utils/ids.js';
import { parseAnnotatedListItems, parseAnnotationList, serializeAnnotations } from '../utils/markdown.js';

/**
 * Durable long-term memory lives in reviewed Vault Markdown, one statement per
 * bullet. Nothing is written here directly: memory changes flow through the
 * operation pipeline so they are diffed, approved, and audited like any other
 * mutation.
 */
export function parseMemoryRecords(markdown, sourcePath) {
  return parseAnnotatedListItems(markdown).map((item) => {
    const annotations = item.annotations ?? {};
    const type = MEMORY_TYPES.includes(String(annotations.type ?? '').toLowerCase())
      ? String(annotations.type).toLowerCase()
      : 'fact';

    return {
      id: annotations.id || derivedId('mem', sourcePath, item.text),
      statement: item.text,
      type,
      sources: parseAnnotationList(annotations.sources),
      confidence: ['low', 'medium', 'high'].includes(annotations.confidence) ? annotations.confidence : 'medium',
      createdAt: annotations.created || null,
      updatedAt: annotations.updated || null,
      conversationId: annotations.conversation || null,
      sourcePath,
      sourceLine: item.line
    };
  });
}

export function serializeMemory(record) {
  const annotations = {
    id: record.id,
    type: record.type,
    confidence: record.confidence,
    sources: (record.sources ?? []).join(','),
    conversation: record.conversationId ?? '',
    created: record.createdAt ?? '',
    updated: record.updatedAt ?? ''
  };
  const suffix = serializeAnnotations(annotations);
  return `- ${record.statement}${suffix ? ` ${suffix}` : ''}`;
}

/** Flags statements that contradict or duplicate an existing memory. */
export function findConflicts(records, statement) {
  const normalized = String(statement ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  const tokens = new Set(normalized.split(/\s+/).filter((token) => token.length > 3));
  if (tokens.size === 0) return [];

  return records
    .map((record) => {
      const candidate = record.statement.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ');
      const candidateTokens = new Set(candidate.split(/\s+/).filter((token) => token.length > 3));
      const shared = [...tokens].filter((token) => candidateTokens.has(token));
      const overlap = shared.length / Math.max(tokens.size, 1);
      return { record, overlap };
    })
    .filter(({ overlap }) => overlap >= 0.6)
    .map(({ record, overlap }) => ({
      id: record.id,
      statement: record.statement,
      type: record.type,
      overlap: Number(overlap.toFixed(2))
    }));
}

export class MemoryRepository {
  constructor({ vaultRepository, memoryPath = VAULT_PATHS.memoryFile }) {
    this.vaultRepository = vaultRepository;
    this.memoryPath = memoryPath;
  }

  async readFile() {
    const file = await this.vaultRepository.readTextIfExists(this.memoryPath);
    return file ?? { path: this.memoryPath, content: '', revision: null, missing: true };
  }

  async list() {
    const file = await this.readFile();
    return {
      path: file.path,
      revision: file.revision ?? null,
      records: parseMemoryRecords(file.content, file.path)
    };
  }

  async get(memoryId) {
    const { records, path, revision } = await this.list();
    const record = records.find((candidate) => candidate.id === memoryId);
    return record ? { record, path, revision } : null;
  }
}
