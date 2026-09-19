import { ok } from '../utils/respond.js';

export function createHealthController({ githubClient, provider, env }) {
  return {
    health(req, res) {
      return ok(res, { status: 'ok', service: 'nexus-api' });
    },

    /** Reports configuration only; it does not probe remote connectivity. */
    vault(req, res) {
      return ok(res, {
        status: githubClient.isConfigured() ? 'configured' : 'not_configured',
        repository: githubClient.repositoryName,
        branch: githubClient.branch,
        writeOperationsEnabled: env.writeOperationsEnabled,
        destructiveOperationsEnabled: env.destructiveOperationsEnabled
      });
    },

    ai(req, res) {
      return ok(res, {
        status: provider.isConfigured() ? 'configured' : 'not_configured',
        provider: env.aiProvider,
        model: provider.isConfigured() ? provider.model : null
      });
    }
  };
}
