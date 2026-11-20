import fs from 'node:fs';
import path from 'node:path';
import { getSql, isDatabaseConfigured } from '../db/client.js';
import { handleListSuggestions } from '../db/handlers.js';

for (const envFile of ['.env.local', '.env']) {
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    try { process.loadEnvFile(envFile); } catch {}
  }
}

if (!isDatabaseConfigured()) {
  console.error('Missing DATABASE_URL. Run `vercel env pull .env.local` after connecting Neon Postgres.');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map(arg => {
    const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
    return [k, v];
  })
);

const view = args.view || 'summary';
const format = args.format || 'json';
const limit = Number(args.limit || 500);
const questionId = args.question || '';
const out = args.out || '';

const sql = getSql();
const result = await handleListSuggestions({ view, format, limit, questionId }, sql);

if (out) {
  const full = path.resolve(out);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2), 'utf8');
  console.log(`Exported (${view}, ${format}) -> ${full}`);
} else if (typeof result.body === 'string') {
  process.stdout.write(result.body);
} else {
  console.log(JSON.stringify(result.body, null, 2));
}
