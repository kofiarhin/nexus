function createVaultError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.expose = true;
  return error;
}

function decodeContent(body) {
  if (!body || typeof body.content !== 'string') {
    throw createVaultError(
      'GitHub Vault returned an invalid response',
      502,
      'VAULT_UPSTREAM_ERROR'
    );
  }

  const content = body.content.replace(/\s/g, '');
  const isValidBase64 = content.length === 0
    || (content.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(content));

  if (!isValidBase64) {
    throw createVaultError(
      'GitHub Vault returned invalid file content',
      502,
      'VAULT_UPSTREAM_ERROR'
    );
  }

  return Buffer.from(content, 'base64').toString('utf8');
}

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
      throw createVaultError(
        'GitHub Vault is not configured',
        503,
        'VAULT_NOT_CONFIGURED'
      );
    }

    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}?ref=${encodeURIComponent(this.branch)}`;
      const response = await this.fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (response.status === 404) {
        throw createVaultError(
          `Vault file not found: ${path}`,
          404,
          'VAULT_FILE_NOT_FOUND'
        );
      }

      if (!response.ok) {
        throw createVaultError(
          'GitHub Vault request failed',
          502,
          'VAULT_UPSTREAM_ERROR'
        );
      }

      return decodeContent(await response.json());
    } catch (error) {
      if (error?.code?.startsWith('VAULT_')) {
        throw error;
      }

      throw createVaultError(
        'GitHub Vault request failed',
        502,
        'VAULT_UPSTREAM_ERROR'
      );
    }
  }
}
