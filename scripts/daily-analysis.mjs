import fs from 'node:fs';
import path from 'node:path';
import { getSql, isDatabaseConfigured } from '../db/client.js';
import { bangkokDateString, formatDailyReportMarkdown, generateDailyAnalysis } from '../db/analytics.js';
import { prepareSurveyBank } from '../src/survey.js';

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
    const [k, ...rest] = arg.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : 'true'];
  })
);

const date = args.date && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : bangkokDateString();
const topLimit = Math.min(200, Math.max(5, Number(args.limit || 40) || 40));
const format = args.format === 'json' || args.json === 'true' ? 'json' : 'markdown';
const out = args.out || '';

const rawBank = JSON.parse(fs.readFileSync(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(rawBank);
const sql = getSql();

const report = await generateDailyAnalysis(sql, bank, { date, topLimit });
const outputText = format === 'json'
  ? JSON.stringify(report, null, 2)
  : formatDailyReportMarkdown(report);

if (out) {
  const full = path.resolve(out);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, outputText, 'utf8');
  console.log(`Saved daily report -> ${full}`);
} else {
  process.stdout.write(outputText + '\n');
}
