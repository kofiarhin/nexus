import 'dotenv/config';

export function loadEnv(environment = process.env) {
  const port = Number(environment.PORT ?? 5000);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error('PORT must be a positive integer');
  }

  return {
    nodeEnv: environment.NODE_ENV ?? 'development',
    port,
    clientUrl: environment.CLIENT_URL ?? 'http://localhost:5173',
    githubToken: environment.GITHUB_TOKEN ?? '',
    githubOwner: environment.GITHUB_OWNER ?? '',
    githubVaultRepo: environment.GITHUB_VAULT_REPO ?? 'nexus-vault',
    githubVaultBranch: environment.GITHUB_VAULT_BRANCH ?? 'main'
  };
}
