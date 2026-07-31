import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const DEFAULT_READ_PATHS = [
  'registry',
  'projects',
  'businesses',
  'tasks',
  'inbox',
  'daily',
  'knowledge',
  'memory',
  'reports',
  'archive',
  'docs',
  'NEXUS.md',
  'README.md'
];

const DEFAULT_WRITE_PATHS = [
  'projects',
  'businesses',
  'tasks',
  'inbox',
  'daily',
  'knowledge',
  'memory',
  'reports',
  'archive',
  'registry'
];

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Expected a boolean value but received "${value}"`);
}

function parseInteger(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseList(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value)
    .split(',')
    .map((item) => item.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
}

export function loadEnv(environment = process.env) {
  const port = parseInteger(environment.PORT, 5000, 'PORT');
  const nodeEnv = environment.NODE_ENV ?? 'development';
  const isProduction = nodeEnv === 'production';

  const authEnabled = parseBoolean(environment.AUTH_ENABLED, true);
  const ownerEmail = (environment.OWNER_EMAIL ?? '').trim().toLowerCase();
  const ownerPasswordHash = (environment.OWNER_PASSWORD_HASH ?? '').trim();
  const ownerConfigured = Boolean(ownerEmail && ownerPasswordHash);

  let sessionSecret = (environment.SESSION_SECRET ?? '').trim();
  if (!sessionSecret) {
    if (isProduction && authEnabled) {
      throw new Error('SESSION_SECRET is required when authentication is enabled in production');
    }
    // Ephemeral secret: sessions do not survive a restart, but no default
    // secret is ever baked into the repository.
    sessionSecret = randomBytes(32).toString('hex');
  }

  const githubToken = environment.GITHUB_TOKEN ?? '';
  const githubOwner = environment.GITHUB_OWNER ?? '';
  const githubVaultRepo = environment.GITHUB_VAULT_REPO ?? 'nexus-vault';
  const vaultConfigured = Boolean(githubToken && githubOwner && githubVaultRepo);

  const writeOperationsRequested = parseBoolean(environment.WRITE_OPERATIONS_ENABLED, false);
  const destructiveOperationsRequested = parseBoolean(
    environment.DESTRUCTIVE_OPERATIONS_ENABLED,
    false
  );

  // Mutations stay disabled unless an authenticated owner can actually be
  // identified: specification section 8 forbids reachable unauthenticated writes.
  const writeOperationsEnabled = writeOperationsRequested && authEnabled && ownerConfigured;
  const destructiveOperationsEnabled = destructiveOperationsRequested && writeOperationsEnabled;

  const nvidiaApiKey = environment.NVIDIA_API_KEY ?? '';

  return {
    nodeEnv,
    isProduction,
    port,
    clientUrl: environment.CLIENT_URL ?? 'http://localhost:5173',

    githubToken,
    githubOwner,
    githubVaultRepo,
    githubVaultBranch: environment.GITHUB_VAULT_BRANCH ?? 'main',
    vaultConfigured,

    aiProvider: (environment.AI_PROVIDER ?? 'nvidia').trim().toLowerCase(),
    nvidiaApiKey,
    nvidiaModel: (environment.NVIDIA_MODEL ?? '').trim() || 'meta/llama-3.1-70b-instruct',
    nvidiaBaseUrl: (environment.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
    nvidiaTimeoutMs: parseInteger(environment.NVIDIA_TIMEOUT_MS, 45000, 'NVIDIA_TIMEOUT_MS'),
    nvidiaMaxOutputTokens: parseInteger(environment.NVIDIA_MAX_OUTPUT_TOKENS, 1200, 'NVIDIA_MAX_OUTPUT_TOKENS'),
    aiConfigured: Boolean(nvidiaApiKey),

    authEnabled,
    ownerEmail,
    ownerPasswordHash,
    ownerName: (environment.OWNER_NAME ?? 'Owner').trim(),
    ownerConfigured,
    sessionSecret,
    sessionTtlMinutes: parseInteger(environment.SESSION_TTL_MINUTES, 720, 'SESSION_TTL_MINUTES'),
    cookieSecure: parseBoolean(environment.COOKIE_SECURE, isProduction),

    writeOperationsRequested,
    writeOperationsEnabled,
    destructiveOperationsRequested,
    destructiveOperationsEnabled,
    autoApproveLowRisk: parseBoolean(environment.AUTO_APPROVE_LOW_RISK, true),

    vaultReadPaths: parseList(environment.VAULT_READ_PATHS, DEFAULT_READ_PATHS),
    vaultWritePaths: parseList(environment.VAULT_WRITE_PATHS, DEFAULT_WRITE_PATHS),

    searchMaxFiles: parseInteger(environment.SEARCH_MAX_FILES, 250, 'SEARCH_MAX_FILES'),
    searchMaxResults: parseInteger(environment.SEARCH_MAX_RESULTS, 40, 'SEARCH_MAX_RESULTS'),
    contextMaxCharacters: parseInteger(environment.CONTEXT_MAX_CHARACTERS, 60000, 'CONTEXT_MAX_CHARACTERS'),
    contextMaxSources: parseInteger(environment.CONTEXT_MAX_SOURCES, 12, 'CONTEXT_MAX_SOURCES'),

    rateLimitWindowMs: parseInteger(environment.RATE_LIMIT_WINDOW_MS, 60000, 'RATE_LIMIT_WINDOW_MS'),
    rateLimitMaxRequests: parseInteger(environment.RATE_LIMIT_MAX_REQUESTS, 600, 'RATE_LIMIT_MAX_REQUESTS'),
    authRateLimitMaxRequests: parseInteger(environment.AUTH_RATE_LIMIT_MAX_REQUESTS, 10, 'AUTH_RATE_LIMIT_MAX_REQUESTS'),

    logEnabled: parseBoolean(environment.LOG_ENABLED, nodeEnv !== 'test')
  };
}

export { DEFAULT_READ_PATHS, DEFAULT_WRITE_PATHS };
