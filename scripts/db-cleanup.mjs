import fs from 'node:fs';
import { getSql, isDatabaseConfigured } from '../db/client.js';
import { ensureSchema } from '../db/schema.js';
import { checkBankCoverage } from '../db/analytics.js';
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

const apply = args.apply === 'true';
const days = Math.max(1, Number(args.days || 60) || 60);
const purgeResolved = args['purge-resolved'] === 'true';

const rawBank = JSON.parse(fs.readFileSync(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(rawBank);
const byId = new Map(bank.questions.map(q => [q.id, q]));
const sql = getSql();
await ensureSchema(sql);

// 1. Identify pending answer_suggestions now covered in bank
const pendingSuggestions = await sql.query(
  `SELECT id, question_id, normalized_answer, suggested_answer, status, created_at
   FROM answer_suggestions
   WHERE status = 'pending'`
);
const coveredSuggestionIds = [];
for (const row of pendingSuggestions) {
  const cov = checkBankCoverage(byId, row.question_id, row.suggested_answer);
  if (cov.status === 'covered') coveredSuggestionIds.push(row.id);
}

// 2. Identify rejected_guesses already covered in current bank or unknown/retired questions
const rejectedRows = await sql.query(
  `SELECT id, question_id, normalized_input, raw_input, created_at
   FROM rejected_guesses`
);
const coveredRejectedIds = [];
const staleRejectedIds = [];
for (const row of rejectedRows) {
  const cov = checkBankCoverage(byId, row.question_id, row.raw_input);
  if (cov.status === 'covered') coveredRejectedIds.push(row.id);
  else if (cov.status === 'unknown_question') staleRejectedIds.push(row.id);
}

// 3. Measure old rows eligible for time-based compaction (> days)
const [oldRoundsCount] = await sql.query(
  `SELECT COUNT(*)::int AS cnt FROM round_attempts WHERE created_at < NOW() - ($1::int * INTERVAL '1 day') AND jsonb_array_length(rejected_inputs) > 0`,
  [days]
);
const [oldResolvedSuggestions] = await sql.query(
  `SELECT COUNT(*)::int AS cnt FROM answer_suggestions WHERE status IN ('added', 'ignored') AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
  [days]
);

const summary = {
  mode: apply ? 'APPLY' : 'DRY_RUN',
  bankVersion: bank.version,
  retentionDays: days,
  suggestionsPendingTotal: pendingSuggestions.length,
  suggestionsMarkAdded: coveredSuggestionIds.length,
  suggestionsOldResolvedToDelete: purgeResolved ? oldResolvedSuggestions.cnt : 0,
  rejectedCoveredToDelete: coveredRejectedIds.length,
  rejectedRetiredQuestionToDelete: staleRejectedIds.length,
  roundAttemptsTrimOldRejectedJson: oldRoundsCount.cnt,
};

if (apply) {
  if (coveredSuggestionIds.length) {
    await sql.query(`UPDATE answer_suggestions SET status = 'added' WHERE id = ANY($1::bigint[])`, [coveredSuggestionIds]);
  }
  const delRejIds = [...coveredRejectedIds, ...staleRejectedIds];
  if (delRejIds.length) {
    await sql.query(`DELETE FROM rejected_guesses WHERE id = ANY($1::bigint[])`, [delRejIds]);
  }
  if (purgeResolved) {
    await sql.query(
      `DELETE FROM answer_suggestions WHERE status IN ('added', 'ignored') AND created_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [days]
    );
  }
  await sql.query(
    `UPDATE round_attempts SET rejected_inputs = '[]'::jsonb WHERE created_at < NOW() - ($1::int * INTERVAL '1 day') AND jsonb_array_length(rejected_inputs) > 0`,
    [days]
  );
}

console.log(JSON.stringify(summary, null, 2));
