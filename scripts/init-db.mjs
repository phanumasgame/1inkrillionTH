import fs from 'node:fs';
import { getSql, isDatabaseConfigured } from '../db/client.js';
import { ensureSchema } from '../db/schema.js';

for (const envFile of ['.env.local', '.env']) {
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envFile); } catch {}
  }
}

if (!isDatabaseConfigured()) {
  console.error('Missing DATABASE_URL. Connect Neon Postgres (or set DATABASE_URL in .env.local) and retry.');
  process.exit(1);
}

const sql = getSql();
await ensureSchema(sql, { force: true });
const tables = await sql.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
);
console.log('Initialized database schema. Tables:', tables.map(r => r.table_name).join(', '));
