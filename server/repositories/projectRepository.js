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

function buildProject({ id, name, path, summary }) {
  if (!PROJECT_PATH_PATTERN.test(path)) return null;

  const slug = id || slugFromPath(path);
  if (!slug) return null;

  return { name: name || slug, slug, path, summary };
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
    summary: status ? `Status: ${status}` : ''
  });
}

function parseProjects(markdown) {
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

export class ProjectRepository {
  constructor(githubClient) {
    this.githubClient = githubClient;
  }

  async list() {
    const markdown = await this.githubClient.readText('registry/PROJECTS.md');
    return parseProjects(markdown);
  }
}

export { parseProjects };
