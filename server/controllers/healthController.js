export function createHealthController({ githubClient }) {
  return {
    health(req, res) {
      return res.status(200).json({
        success: true,
        data: { status: 'ok', service: 'nexus-api' },
        requestId: res.locals.requestId
      });
    },

    vault(req, res) {
      return res.status(200).json({
        success: true,
        data: {
          status: githubClient.isConfigured() ? 'configured' : 'not_configured',
          repository: githubClient.owner && githubClient.repo
            ? `${githubClient.owner}/${githubClient.repo}`
            : null,
          branch: githubClient.branch
        },
        requestId: res.locals.requestId
      });
    }
  };
}
