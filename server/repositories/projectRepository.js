function parseProjects(markdown) {
  const rows = markdown
    .split('\n')
    .filter((line) => /^\|\s*\[[^\]]+\]/.test(line));

  return rows
    .map((line) => {
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      const match = cells[0].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (!match) return null;

      return {
        name: match[1],
        slug: match[2].replace(/^projects\//, '').replace(/\.md$/, ''),
        path: match[2],
        summary: cells[1] ?? ''
      };
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
