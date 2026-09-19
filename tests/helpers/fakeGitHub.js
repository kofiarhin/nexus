import { createHash } from 'node:crypto';

/**
 * In-memory stand-in for the GitHub Contents/Git API.
 *
 * Tests exercise the real GitHubClient, VaultRepository, and operation
 * pipeline against this, so revision handling, conflicts, and readback
 * verification are covered without any network access or real credentials.
 */

const blobSha = (content) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
const commitSha = (seed) => createHash('sha1').update(`commit ${seed}`).digest('hex');

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

export function createFakeGitHub({ files = {}, owner = 'kofiarhin', repo = 'nexus-vault', branch = 'main' } = {}) {
  /** path -> { content, history: [{ revision, content, message, date }] } */
  const store = new Map();
  let commitCounter = 0;

  const write = (path, content, message) => {
    commitCounter += 1;
    const commit = commitSha(`${path}:${commitCounter}`);
    const entry = store.get(path) ?? { history: [] };
    entry.content = content;
    entry.history = [
      { revision: commit, content, message: message ?? `Update ${path}`, date: `2026-07-31T0${Math.min(commitCounter, 9)}:00:00Z` },
      ...entry.history
    ];
    store.set(path, entry);
    return commit;
  };

  for (const [path, content] of Object.entries(files)) write(path, content, `Seed ${path}`);

  const state = {
    calls: [],
    /** Fails the next matching request, to exercise upstream error handling. */
    failNext: null,
    /** Rewrites a file behind the caller's back to force a revision conflict. */
    mutateBehind: (path, content) => write(path, content, 'Concurrent change'),
    read: (path) => store.get(path)?.content ?? null,
    has: (path) => store.has(path),
    paths: () => [...store.keys()],
    shaOf: (path) => (store.has(path) ? blobSha(store.get(path).content) : null)
  };

  const contentsPrefix = `/repos/${owner}/${repo}/contents/`;

  const fetchImpl = async (url, options = {}) => {
    const target = new URL(url);
    const method = options.method ?? 'GET';
    state.calls.push({ url: target.pathname + target.search, method });

    if (state.failNext) {
      const failure = state.failNext;
      state.failNext = null;
      if (failure === 'network') throw new Error('socket failure with sensitive upstream details');
      return json({ message: 'upstream failure' }, failure);
    }

    // Recursive git tree.
    if (target.pathname.startsWith(`/repos/${owner}/${repo}/git/trees/`)) {
      const directories = new Set();
      for (const path of store.keys()) {
        const segments = path.split('/');
        for (let index = 1; index < segments.length; index += 1) {
          directories.add(segments.slice(0, index).join('/'));
        }
      }
      return json({
        truncated: false,
        tree: [
          ...[...directories].map((path) => ({ path, type: 'tree', sha: blobSha(path) })),
          ...[...store.entries()].map(([path, entry]) => ({
            path,
            type: 'blob',
            sha: blobSha(entry.content),
            size: Buffer.byteLength(entry.content)
          }))
        ]
      });
    }

    // Commit history for a path.
    if (target.pathname === `/repos/${owner}/${repo}/commits`) {
      const path = target.searchParams.get('path');
      const entry = store.get(path);
      if (!entry) return json({ message: 'Not Found' }, 404);
      return json(
        entry.history.map((revision) => ({
          sha: revision.revision,
          commit: { message: revision.message, author: { name: 'Owner', date: revision.date } },
          html_url: `https://github.com/${owner}/${repo}/commit/${revision.revision}`
        }))
      );
    }

    if (!target.pathname.startsWith(contentsPrefix)) {
      return json({ message: 'Not Found' }, 404);
    }

    const path = decodeURIComponent(target.pathname.slice(contentsPrefix.length));
    const body = options.body ? JSON.parse(options.body) : null;

    if (method === 'GET') {
      const ref = target.searchParams.get('ref');

      // A historical ref resolves through the recorded commit history.
      if (ref && ref !== branch) {
        const entry = store.get(path);
        const revision = entry?.history.find((candidate) => candidate.revision === ref);
        if (!revision) return json({ message: 'Not Found' }, 404);
        return json({
          path,
          content: Buffer.from(revision.content).toString('base64'),
          sha: blobSha(revision.content),
          size: Buffer.byteLength(revision.content)
        });
      }

      if (store.has(path)) {
        const content = store.get(path).content;
        return json({
          path,
          content: Buffer.from(content).toString('base64'),
          sha: blobSha(content),
          size: Buffer.byteLength(content)
        });
      }

      // Directory listing.
      const prefix = path === '' ? '' : `${path}/`;
      const children = new Map();
      for (const candidate of store.keys()) {
        if (path !== '' && !candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        const [name, ...deeper] = rest.split('/');
        if (!name) continue;
        const childPath = prefix + name;
        children.set(childPath, {
          name,
          path: childPath,
          type: deeper.length > 0 ? 'dir' : 'file',
          sha: deeper.length > 0 ? blobSha(childPath) : blobSha(store.get(childPath)?.content ?? ''),
          size: deeper.length > 0 ? 0 : Buffer.byteLength(store.get(childPath)?.content ?? '')
        });
      }
      if (children.size === 0) return json({ message: 'Not Found' }, 404);
      return json([...children.values()]);
    }

    if (method === 'PUT') {
      const exists = store.has(path);
      const content = Buffer.from(body.content, 'base64').toString('utf8');

      if (!body.sha && exists) {
        return json({ message: `"${path}" already exists` }, 422);
      }
      if (body.sha) {
        if (!exists) return json({ message: 'Not Found' }, 404);
        if (body.sha !== blobSha(store.get(path).content)) {
          return json({ message: 'sha does not match' }, 409);
        }
      }

      const commit = write(path, content, body.message);
      return json({
        content: { path, sha: blobSha(content) },
        commit: { sha: commit }
      });
    }

    if (method === 'DELETE') {
      if (!store.has(path)) return json({ message: 'Not Found' }, 404);
      if (body.sha !== blobSha(store.get(path).content)) {
        return json({ message: 'sha does not match' }, 409);
      }
      commitCounter += 1;
      const commit = commitSha(`${path}:delete:${commitCounter}`);
      store.delete(path);
      return json({ commit: { sha: commit } });
    }

    return json({ message: 'Method Not Allowed' }, 405);
  };

  return { fetchImpl, state };
}

export { blobSha };
