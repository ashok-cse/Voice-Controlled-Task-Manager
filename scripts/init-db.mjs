#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '..', 'schema.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Add it to .env first.');
  process.exit(1);
}

const sql = readFileSync(schemaPath, 'utf8');
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

await client.connect();
try {
  await client.query(sql);
  console.log('Schema applied.');
} catch (err) {
  console.error('Failed to apply schema:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
