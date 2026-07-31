import { appError } from './errors.js';

const MAX_PATH_LENGTH = 400;
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Normalizes a Vault path to a repository-relative POSIX path.
 * Rejects absolute paths, traversal, backslashes, and anything outside the
 * conservative segment character set before any allowlist check runs.
 */
export function normalizeVaultPath(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw appError('VALIDATION_ERROR', 'A Vault path is required');
  }

  const raw = input.trim();

  if (raw.length > MAX_PATH_LENGTH) {
    throw appError('VALIDATION_ERROR', 'Vault path is too long');
  }

  if (raw.includes('\\')) {
    throw appError('VALIDATION_ERROR', 'Vault path contains unsupported characters');
  }

  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw appError('VALIDATION_ERROR', 'Vault path must be repository-relative');
  }

  const segments = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      throw appError('PATH_NOT_ALLOWED', 'Vault path traversal is not permitted');
    }
    // The segment pattern also rejects spaces, control characters, and quoting.
    if (!SEGMENT_PATTERN.test(segment)) {
      throw appError('VALIDATION_ERROR', `Vault path segment is not permitted: ${segment}`);
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw appError('VALIDATION_ERROR', 'A Vault path is required');
  }

  return segments.join('/');
}

/** Directory paths may be empty (the Vault root) but follow the same rules. */
export function normalizeDirectoryPath(input) {
  if (input === undefined || input === null || String(input).trim() === '' || input === '/') {
    return '';
  }
  return normalizeVaultPath(input);
}

export const isMarkdownPath = (path) => /\.md$/i.test(path);

function matchesPrefix(path, prefix) {
  if (prefix === '' || prefix === '*') return true;
  const clean = prefix.replace(/\/+$/, '');
  return path === clean || path.startsWith(`${clean}/`);
}

/**
 * Server-side path policy for a normalized path.
 * Read and write allowlists are configured separately so a path can be
 * readable without being writable.
 */
export function assertPathAllowed(path, allowlist, action = 'read') {
  const prefixes = Array.isArray(allowlist) ? allowlist : [];
  if (prefixes.length === 0) {
    throw appError('PATH_NOT_ALLOWED', `No Vault paths are allowed for ${action}`);
  }
  if (!prefixes.some((prefix) => matchesPrefix(path, prefix))) {
    throw appError('PATH_NOT_ALLOWED', `Vault path is not allowed for ${action}: ${path}`, { path, action });
  }
  return path;
}

export function isPathAllowed(path, allowlist) {
  const prefixes = Array.isArray(allowlist) ? allowlist : [];
  return prefixes.some((prefix) => matchesPrefix(path, prefix));
}

export const parentDirectory = (path) => path.split('/').slice(0, -1).join('/');

export const basename = (path) => path.split('/').filter(Boolean).pop() ?? '';

/** Default archive destination: `archive/<original path>` stamped with the date. */
export function archiveDestination(path, now = new Date()) {
  const stamp = now.toISOString().slice(0, 10);
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const directory = parentDirectory(path);
  const prefix = directory ? `archive/${directory}` : 'archive';
  return `${prefix}/${stem}.${stamp}${extension}`;
}
