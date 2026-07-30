export class GitHubClient {
  constructor({ token, owner, repo, branch, fetchImpl = fetch }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.token && this.owner && this.repo);
  }

  async readText(path) {
    if (!this.isConfigured()) {
      const error = new Error('GitHub Vault is not configured');
      error.status = 503;
      error.code = 'VAULT_NOT_CONFIGURED';
      throw error;
    }

    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}?ref=${encodeURIComponent(this.branch)}`;
    const response = await this.fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });

    if (response.status === 404) {
      const error = new Error(`Vault file not found: ${path}`);
      error.status = 404;
      error.code = 'VAULT_FILE_NOT_FOUND';
      throw error;
    }

    if (!response.ok) {
      const error = new Error('GitHub Vault request failed');
      error.status = 502;
      error.code = 'VAULT_UPSTREAM_ERROR';
      throw error;
    }

    const body = await response.json();
    return Buffer.from(body.content, 'base64').toString('utf8');
  }
}
