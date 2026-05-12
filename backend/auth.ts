import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query } from './db';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_DAYS = 30;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateInput(email: string, password: string): void {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
}

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [token, userId, String(SESSION_TTL_DAYS)]
  );
  return token;
}

export async function signup(rawEmail: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const email = normalizeEmail(rawEmail);
  validateInput(email, password);

  const existing = await query<{ id: string }>(
    `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  if (existing.length) throw new Error('An account with that email already exists.');

  const passwordHash = await hashPassword(password);
  const name = email.split('@')[0] || 'user';
  const rows = await query<{ id: string; email: string; name: string }>(
    `INSERT INTO users (email, password_hash, name)
     VALUES ($1, $2, $3)
     RETURNING id, email, name`,
    [email, passwordHash, name]
  );
  const user = rows[0];
  const token = await createSession(user.id);
  return { token, user };
}

export async function login(rawEmail: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const email = normalizeEmail(rawEmail);
  if (!email || !password) throw new Error('Email and password are required.');

  const rows = await query<{ id: string; email: string; name: string; password_hash: string | null }>(
    `SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new Error('Invalid email or password.');
  }
  const token = await createSession(row.id);
  return { token, user: { id: row.id, email: row.email, name: row.name } };
}

export async function logout(token: string): Promise<void> {
  if (!token) return;
  await query(`DELETE FROM sessions WHERE token = $1`, [token]);
}

export async function resolveSession(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token) return null;
  const rows = await query<{ id: string; email: string; name: string }>(
    `SELECT u.id, u.email, u.name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()
     LIMIT 1`,
    [token]
  );
  return rows[0] ?? null;
}
