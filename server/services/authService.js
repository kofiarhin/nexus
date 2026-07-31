import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';
import { appError } from '../utils/errors.js';

const SCRYPT_KEY_LENGTH = 64;
const HASH_PREFIX = 'scrypt';

/** `scrypt$<salt-hex>$<key-hex>` — the format stored in OWNER_PASSWORD_HASH. */
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(String(password), salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `${HASH_PREFIX}$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return false;

  const [, salt, expected] = parts;
  let derived;
  try {
    derived = scryptSync(String(password), salt, SCRYPT_KEY_LENGTH).toString('hex');
  } catch {
    return false;
  }

  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const base64url = (value) => Buffer.from(value).toString('base64url');
const fromBase64url = (value) => Buffer.from(value, 'base64url').toString('utf8');

/**
 * Stateless signed session tokens.
 *
 * A token is `<payload>.<hmac>`; the server holds no session table, so a
 * restart with a generated SESSION_SECRET simply invalidates every session.
 */
export function createSessionToken(payload, secret) {
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function readSessionToken(token, secret) {
  const value = String(token ?? '');
  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(fromBase64url(body));
  } catch {
    return null;
  }
}

export class AuthService {
  constructor({ env, now = () => Date.now() }) {
    this.env = env;
    this.now = now;
  }

  get enabled() {
    return this.env.authEnabled;
  }

  get configured() {
    return this.env.ownerConfigured;
  }

  status() {
    return {
      authEnabled: this.env.authEnabled,
      authConfigured: this.env.ownerConfigured,
      owner: this.env.ownerConfigured ? { email: this.env.ownerEmail, name: this.env.ownerName } : null
    };
  }

  login({ email, password }) {
    if (!this.env.authEnabled) {
      throw appError('AUTH_NOT_CONFIGURED', 'Authentication is disabled in this environment');
    }
    if (!this.env.ownerConfigured) {
      throw appError(
        'AUTH_NOT_CONFIGURED',
        'Owner credentials are not configured. Set OWNER_EMAIL and OWNER_PASSWORD_HASH.'
      );
    }

    const emailMatches = String(email ?? '').trim().toLowerCase() === this.env.ownerEmail;
    const passwordMatches = verifyPassword(password, this.env.ownerPasswordHash);

    // Both checks always run so a wrong email and a wrong password cost the same.
    if (!emailMatches || !passwordMatches) {
      throw appError('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }

    const issuedAt = this.now();
    const expiresAt = issuedAt + this.env.sessionTtlMinutes * 60 * 1000;
    const principal = {
      id: 'owner',
      email: this.env.ownerEmail,
      name: this.env.ownerName,
      role: 'owner'
    };

    return {
      principal,
      token: createSessionToken(
        { sub: principal.id, email: principal.email, role: 'owner', iat: issuedAt, exp: expiresAt, jti: randomUUID() },
        this.env.sessionSecret
      ),
      expiresAt: new Date(expiresAt).toISOString(),
      maxAgeMs: expiresAt - issuedAt
    };
  }

  /** Returns the principal for a session token, or null when unusable. */
  resolvePrincipal(token) {
    if (!this.env.authEnabled) {
      return { id: 'owner', email: this.env.ownerEmail || 'owner@localhost', name: this.env.ownerName, role: 'owner', authenticated: false };
    }

    const payload = readSessionToken(token, this.env.sessionSecret);
    if (!payload) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= this.now()) return null;
    if (payload.role !== 'owner' || payload.email !== this.env.ownerEmail) return null;

    return {
      id: payload.sub ?? 'owner',
      email: payload.email,
      name: this.env.ownerName,
      role: 'owner',
      authenticated: true,
      sessionId: payload.jti ?? null,
      expiresAt: new Date(payload.exp).toISOString()
    };
  }
}
