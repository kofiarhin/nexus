import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../server/config/env.js';

describe('loadEnv', () => {
  it('uses safe defaults', () => {
    expect(loadEnv({})).toMatchObject({
      port: 5000,
      githubVaultRepo: 'nexus-vault',
      githubVaultBranch: 'main'
    });
  });

  it('rejects invalid ports', () => {
    expect(() => loadEnv({ PORT: 'invalid' })).toThrow('PORT');
  });
});
