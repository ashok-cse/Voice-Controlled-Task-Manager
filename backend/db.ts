import pg from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[db] DATABASE_URL is not set — Postgres calls will fail.');
}

export const pool = new pg.Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5
});

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params as never);
  return res.rows as T[];
}
