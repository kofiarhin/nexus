import { describe, expect, it } from 'vitest';
import {
  AuthService,
  createSessionToken,
  hashPassword,
  readSessionToken,
  verifyPassword
} from '../../server/services/authService.js';
import { loadEnv } from '../../server/config/env.js';

const PASSWORD = 'a-sufficiently-long-test-password';

const baseEnvironment = (overrides = {}) => loadEnv({
  PORT: '5000',
  SESSION_SECRET: 'unit-test-secret',
  OWNER_EMAIL: 'owner@example.test',
  OWNER_PASSWORD_HASH: hashPassword(PASSWORD),
  ...overrides
});

describe('password hashing', () => {
  it('produces a salted hash that verifies', () => {
    const hash = hashPassword(PASSWORD);
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword(PASSWORD, hash)).toBe(true);
  });

  it('never stores the password itself', () => {
    expect(hashPassword(PASSWORD)).not.toContain(PASSWORD);
  });

  it('uses a fresh salt for each hash', () => {
    expect(hashPassword(PASSWORD)).not.toBe(hashPassword(PASSWORD));
  });

  it('rejects a wrong password and a malformed hash', () => {
    expect(verifyPassword('wrong', hashPassword(PASSWORD))).toBe(false);
    expect(verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
    expect(verifyPassword(PASSWORD, '')).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips a signed payload', () => {
    const token = createSessionToken({ sub: 'owner', exp: 123 }, 'secret');
    expect(readSessionToken(token, 'secret')).toEqual({ sub: 'owner', exp: 123 });
  });

  it('rejects a token signed with a different secret', () => {
    const token = createSessionToken({ sub: 'owner' }, 'secret');
    expect(readSessionToken(token, 'other-secret')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const token = createSessionToken({ sub: 'owner', role: 'owner' }, 'secret');
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker', role: 'owner' })).toString('base64url');
    expect(readSessionToken(`${forged}.${signature}`, 'secret')).toBeNull();
    expect(readSessionToken(`${body}.`, 'secret')).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(readSessionToken('', 'secret')).toBeNull();
    expect(readSessionToken('nodot', 'secret')).toBeNull();
  });
});

describe('AuthService', () => {
  it('issues a session for the configured owner', () => {
    const service = new AuthService({ env: baseEnvironment() });
    const session = service.login({ email: 'owner@example.test', password: PASSWORD });

    expect(session.principal).toMatchObject({ role: 'owner', email: 'owner@example.test' });
    expect(service.resolvePrincipal(session.token)).toMatchObject({ authenticated: true, role: 'owner' });
  });

  it('is case-insensitive about the owner email', () => {
    const service = new AuthService({ env: baseEnvironment() });
    expect(() => service.login({ email: 'OWNER@EXAMPLE.TEST', password: PASSWORD })).not.toThrow();
  });

  it('rejects a wrong password and an unknown email with the same error', () => {
    const service = new AuthService({ env: baseEnvironment() });
    expect(() => service.login({ email: 'owner@example.test', password: 'wrong' }))
      .toThrow(/email or password is incorrect/i);
    expect(() => service.login({ email: 'someone@else.test', password: PASSWORD }))
      .toThrow(/email or password is incorrect/i);
  });

  it('reports that owner credentials are not configured', () => {
    const service = new AuthService({ env: loadEnv({ PORT: '5000', SESSION_SECRET: 'x' }) });
    expect(service.configured).toBe(false);
    expect(() => service.login({ email: 'a@b.test', password: PASSWORD })).toThrow(/not configured/i);
  });

  it('rejects an expired session', () => {
    const env = baseEnvironment();
    const service = new AuthService({ env, now: () => 1_000_000 });
    const expired = createSessionToken(
      { sub: 'owner', email: env.ownerEmail, role: 'owner', exp: 999_999 },
      env.sessionSecret
    );
    expect(service.resolvePrincipal(expired)).toBeNull();
  });

  it('rejects a session whose email no longer matches the configured owner', () => {
    const env = baseEnvironment();
    const service = new AuthService({ env });
    const token = createSessionToken(
      { sub: 'owner', email: 'former@example.test', role: 'owner', exp: Date.now() + 60_000 },
      env.sessionSecret
    );
    expect(service.resolvePrincipal(token)).toBeNull();
  });

  it('returns an unauthenticated local owner when authentication is disabled', () => {
    const service = new AuthService({ env: loadEnv({ PORT: '5000', AUTH_ENABLED: 'false' }) });
    expect(service.resolvePrincipal(null)).toMatchObject({ role: 'owner', authenticated: false });
  });
});

describe('environment safety rules', () => {
  it('keeps writes disabled unless an owner is configured', () => {
    const env = loadEnv({ PORT: '5000', WRITE_OPERATIONS_ENABLED: 'true', SESSION_SECRET: 'x' });
    expect(env.writeOperationsRequested).toBe(true);
    expect(env.writeOperationsEnabled).toBe(false);
  });

  it('keeps destructive operations disabled unless writes are enabled', () => {
    const env = loadEnv({
      PORT: '5000',
      DESTRUCTIVE_OPERATIONS_ENABLED: 'true',
      SESSION_SECRET: 'x',
      OWNER_EMAIL: 'owner@example.test',
      OWNER_PASSWORD_HASH: hashPassword(PASSWORD)
    });
    expect(env.destructiveOperationsEnabled).toBe(false);
  });

  it('enables writes once authentication and the flag are both configured', () => {
    const env = loadEnv({
      PORT: '5000',
      SESSION_SECRET: 'x',
      OWNER_EMAIL: 'owner@example.test',
      OWNER_PASSWORD_HASH: hashPassword(PASSWORD),
      WRITE_OPERATIONS_ENABLED: 'true',
      DESTRUCTIVE_OPERATIONS_ENABLED: 'true'
    });
    expect(env.writeOperationsEnabled).toBe(true);
    expect(env.destructiveOperationsEnabled).toBe(true);
  });

  it('requires a session secret in production', () => {
    expect(() => loadEnv({ PORT: '5000', NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
  });

  it('rejects a non-boolean flag value', () => {
    expect(() => loadEnv({ PORT: '5000', AUTH_ENABLED: 'maybe' })).toThrow(/boolean/i);
  });
});
