import { timingSafeEqual } from 'node:crypto';
import { normalize } from '../src/answers.js';
import { ensureSchema } from './schema.js';

const cleanStr = (v, max = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const safeInt = (v, min = 0, max = 100000) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : min;
};

export function splitSuggestedAnswers(input) {
  const rawList = Array.isArray(input)
    ? input
    : String(input ?? '').split(/[\n,;،]+/);
  const seen = new Set();
  const out = [];
  for (const item of rawList) {
    const label = cleanStr(item, 120);
    if (!label) continue;
    const norm = normalize(label);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ label, normalized: norm });
    if (out.length >= 10) break;
  }
  return out;
}

export function verifyAdminToken(provided, expected) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(provided), 'utf8');
  const b = Buffer.from(String(expected), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function extractBearerToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization || '';
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  if (req.query?.token) return String(req.query.token).trim();
  return '';
}

export function toCsv(rows, columns) {
  const escapeCell = value => {
    const str = Array.isArray(value) ? value.join(' | ') : String(value ?? '');
    if (/[",\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  };
  const header = columns.map(escapeCell).join(',');
  const body = rows.map(row => columns.map(col => escapeCell(row[col])).join(',')).join('\r\n');
  // UTF-8 BOM ensures Excel renders Thai characters cleanly
  return '\uFEFF' + header + '\r\n' + body + (body ? '\r\n' : '');
}

export async function handleCreateSuggestions(body, sql, { ensure = ensureSchema } = {}) {
  if (!body || typeof body !== 'object') {
    return { status: 400, body: { ok: false, error: 'Invalid JSON payload' } };
  }
  const questionId = cleanStr(body.questionId, 80);
  if (!questionId) {
    return { status: 400, body: { ok: false, error: 'Missing questionId' } };
  }
  const items = splitSuggestedAnswers(body.suggestions ?? body.suggestedAnswer ?? '');
  if (!items.length) {
    return { status: 400, body: { ok: false, error: 'กรุณาพิมพ์คำตอบที่ต้องการเสนออย่างน้อย 1 รายการ' } };
  }

  const questionPrompt = cleanStr(body.questionPrompt, 240);
  const note = cleanStr(body.note, 400);
  const source = ['survey', 'rejected-chip'].includes(body.source) ? body.source : 'survey';
  const bankVersion = cleanStr(body.bankVersion, 40);
  const mode = ['daily', 'endless'].includes(body.mode) ? body.mode : 'daily';
  const sessionId = cleanStr(body.sessionId, 120);
  const clientId = cleanStr(body.clientId, 80);

  await ensure(sql);

  const inserted = [];
  for (const item of items) {
    const rows = await sql.query(
      `INSERT INTO answer_suggestions
        (question_id, question_prompt, suggested_answer, normalized_answer, note, source, bank_version, mode, session_id, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, created_at, question_id, suggested_answer, normalized_answer`,
      [questionId, questionPrompt, item.label, item.normalized, note, source, bankVersion, mode, sessionId, clientId]
    );
    inserted.push(rows[0] || { question_id: questionId, suggested_answer: item.label, normalized_answer: item.normalized });
  }

  return {
    status: 201,
    body: { ok: true, saved: inserted.length, items: inserted },
  };
}

export async function handleListSuggestions(query, sql, { ensure = ensureSchema } = {}) {
  await ensure(sql);
  const view = ['summary', 'raw', 'rejected', 'questions'].includes(query?.view) ? query.view : 'summary';
  const format = query?.format === 'csv' ? 'csv' : 'json';
  const limit = safeInt(query?.limit ?? 500, 1, 2000);
  const questionId = cleanStr(query?.questionId, 80);

  if (view === 'raw') {
    const rows = questionId
      ? await sql.query(
          `SELECT id, created_at, question_id, question_prompt, suggested_answer, normalized_answer, note, source, bank_version, mode, status
           FROM answer_suggestions WHERE question_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [questionId, limit]
        )
      : await sql.query(
          `SELECT id, created_at, question_id, question_prompt, suggested_answer, normalized_answer, note, source, bank_version, mode, status
           FROM answer_suggestions ORDER BY created_at DESC LIMIT $1`,
          [limit]
        );
    if (format === 'csv') {
      return {
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        filename: 'krillion-suggestions-raw.csv',
        body: toCsv(rows, ['id', 'created_at', 'question_id', 'question_prompt', 'suggested_answer', 'normalized_answer', 'note', 'source', 'bank_version', 'mode', 'status']),
      };
    }
    return { status: 200, body: { ok: true, view, count: rows.length, rows } };
  }

  if (view === 'rejected') {
    const rows = questionId
      ? await sql.query(
          `SELECT question_id, normalized_input, MIN(raw_input) AS sample_input, COUNT(*)::int AS miss_count, MAX(created_at) AS last_seen
           FROM rejected_guesses WHERE question_id = $1
           GROUP BY question_id, normalized_input ORDER BY miss_count DESC, last_seen DESC LIMIT $2`,
          [questionId, limit]
        )
      : await sql.query(
          `SELECT question_id, normalized_input, MIN(raw_input) AS sample_input, COUNT(*)::int AS miss_count, MAX(created_at) AS last_seen
           FROM rejected_guesses
           GROUP BY question_id, normalized_input ORDER BY miss_count DESC, last_seen DESC LIMIT $1`,
          [limit]
        );
    if (format === 'csv') {
      return {
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        filename: 'krillion-rejected-guesses.csv',
        body: toCsv(rows, ['question_id', 'sample_input', 'normalized_input', 'miss_count', 'last_seen']),
      };
    }
    return { status: 200, body: { ok: true, view, count: rows.length, rows } };
  }

  if (view === 'questions') {
    const rows = await sql.query(
      `SELECT question_id,
              COUNT(*)::int AS plays,
              SUM(CASE WHEN outcome IN ('skip','timeout') THEN 1 ELSE 0 END)::int AS misses,
              ROUND(AVG(points)::numeric, 1) AS avg_points,
              ROUND(AVG(jsonb_array_length(rejected_inputs))::numeric, 2) AS avg_rejected_inputs
       FROM round_attempts
       GROUP BY question_id
       ORDER BY misses DESC, plays DESC
       LIMIT $1`,
      [limit]
    );
    if (format === 'csv') {
      return {
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        filename: 'krillion-question-analytics.csv',
        body: toCsv(rows, ['question_id', 'plays', 'misses', 'avg_points', 'avg_rejected_inputs']),
      };
    }
    return { status: 200, body: { ok: true, view, count: rows.length, rows } };
  }

  // Default: summary (top suggested answers grouped + top rejected guesses)
  const suggestions = questionId
    ? await sql.query(
        `SELECT question_id,
                MAX(question_prompt) AS question_prompt,
                MIN(suggested_answer) AS sample_answer,
                normalized_answer,
                COUNT(*)::int AS suggestion_count,
                STRING_AGG(DISTINCT NULLIF(note, ''), ' | ') AS notes,
                MAX(created_at) AS last_seen
         FROM answer_suggestions
         WHERE question_id = $1
         GROUP BY question_id, normalized_answer
         ORDER BY suggestion_count DESC, last_seen DESC
         LIMIT $2`,
        [questionId, limit]
      )
    : await sql.query(
        `SELECT question_id,
                MAX(question_prompt) AS question_prompt,
                MIN(suggested_answer) AS sample_answer,
                normalized_answer,
                COUNT(*)::int AS suggestion_count,
                STRING_AGG(DISTINCT NULLIF(note, ''), ' | ') AS notes,
                MAX(created_at) AS last_seen
         FROM answer_suggestions
         GROUP BY question_id, normalized_answer
         ORDER BY suggestion_count DESC, last_seen DESC
         LIMIT $1`,
        [limit]
      );

  if (format === 'csv') {
    return {
      status: 200,
      contentType: 'text/csv; charset=utf-8',
      filename: 'krillion-suggestions-summary.csv',
      body: toCsv(suggestions, ['question_id', 'question_prompt', 'sample_answer', 'normalized_answer', 'suggestion_count', 'notes', 'last_seen']),
    };
  }

  const topRejected = await sql.query(
    `SELECT question_id, normalized_input, MIN(raw_input) AS sample_input, COUNT(*)::int AS miss_count, MAX(created_at) AS last_seen
     FROM rejected_guesses
     GROUP BY question_id, normalized_input
     ORDER BY miss_count DESC, last_seen DESC
     LIMIT 200`
  );
  return {
    status: 200,
    body: {
      ok: true,
      view: 'summary',
      suggestionsCount: suggestions.length,
      suggestions,
      rejectedCount: topRejected.length,
      topRejected,
    },
  };
}

export async function handleRecordTelemetry(body, sql, { ensure = ensureSchema } = {}) {
  if (!body || typeof body !== 'object') {
    return { status: 400, body: { ok: false, error: 'Invalid JSON payload' } };
  }
  const sessionId = cleanStr(body.sessionId, 120);
  if (!sessionId) {
    return { status: 400, body: { ok: false, error: 'Missing sessionId' } };
  }
  const mode = ['daily', 'endless'].includes(body.mode) ? body.mode : 'daily';
  const dailyDate = cleanStr(body.date, 20);
  const bankVersion = cleanStr(body.bankVersion, 40);
  const clientId = cleanStr(body.clientId, 80);
  const score = safeInt(body.score, 0, 700);
  const depth = safeInt(body.depth, 0, 7000);
  const gems = safeInt(body.gems, 0, 7);
  const rounds = Array.isArray(body.rounds) ? body.rounds.slice(0, 7) : [];

  await ensure(sql);

  const insertedSession = await sql.query(
    `INSERT INTO dive_sessions (session_id, client_id, mode, daily_date, bank_version, score, depth, gems)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (session_id) DO NOTHING
     RETURNING id`,
    [sessionId, clientId, mode, dailyDate, bankVersion, score, depth, gems]
  );

  if (!insertedSession.length) {
    return { status: 200, body: { ok: true, deduplicated: true, roundsSaved: 0, rejectedSaved: 0 } };
  }

  let roundsSaved = 0;
  let rejectedSaved = 0;

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    if (!r || typeof r !== 'object') continue;
    const questionId = cleanStr(r.questionId, 80);
    if (!questionId) continue;
    const outcome = ['correct', 'corrected', 'skip', 'timeout'].includes(r.reason) ? r.reason : 'timeout';
    const answerId = cleanStr(r.answerId, 80);
    const answerLabel = cleanStr(r.label, 120);
    const tier = ['plankton', 'schooler', 'rare', 'deepcut', 'krillion'].includes(r.tier) ? r.tier : '';
    const points = safeInt(r.points, 0, 100);
    const elapsedMs = safeInt(r.elapsedMs, 0, 60000);

    const rejected = [];
    const seenRej = new Set();
    for (const rawInput of Array.isArray(r.rejectedInputs) ? r.rejectedInputs.slice(0, 15) : []) {
      const cleaned = cleanStr(rawInput, 120);
      const norm = normalize(cleaned);
      if (!cleaned || !norm || seenRej.has(norm)) continue;
      seenRej.add(norm);
      rejected.push({ raw: cleaned, norm });
    }

    await sql.query(
      `INSERT INTO round_attempts
        (session_id, client_id, bank_version, mode, round_index, question_id, outcome, answer_id, answer_label, tier, points, elapsed_ms, rejected_inputs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [sessionId, clientId, bankVersion, mode, i, questionId, outcome, answerId, answerLabel, tier, points, elapsedMs, JSON.stringify(rejected.map(x => x.raw))]
    );
    roundsSaved++;

    for (const rej of rejected) {
      await sql.query(
        `INSERT INTO rejected_guesses (session_id, client_id, bank_version, question_id, raw_input, normalized_input)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, clientId, bankVersion, questionId, rej.raw, rej.norm]
      );
      rejectedSaved++;
    }
  }

  return { status: 201, body: { ok: true, deduplicated: false, roundsSaved, rejectedSaved } };
}
