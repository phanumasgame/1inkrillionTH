import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  extractBearerToken,
  handleAdminAction,
  handleAdminDashboard,
  handleCreateSuggestions,
  handleListSuggestions,
  handleRecordTelemetry,
  splitSuggestedAnswers,
  toCsv,
  verifyAdminToken,
} from '../db/handlers.js';
import { ensureSchema, resetSchemaCache, SCHEMA_STATEMENTS } from '../db/schema.js';
import { createSession, nextRound, PREVIEW_MS, selectDaily, submitAnswer, tickSession } from '../src/game.js';
import { emptySave, ensureClientId } from '../src/storage.js';
import { prepareSurveyBank } from '../src/survey.js';

function createFakeSql() {
  const tables = {
    answer_suggestions: [],
    dive_sessions: [],
    round_attempts: [],
    rejected_guesses: [],
  };
  const executed = [];
  let seq = 1;

  return {
    tables,
    executed,
    async query(text, params = []) {
      const sql = text.replace(/\s+/g, ' ').trim();
      executed.push({ sql, params });

      if (sql.startsWith('CREATE TABLE') || sql.startsWith('CREATE INDEX')) return [];

      if (sql.startsWith('INSERT INTO answer_suggestions')) {
        const row = {
          id: seq++,
          created_at: '2026-11-20T10:00:00.000Z',
          question_id: params[0],
          question_prompt: params[1],
          suggested_answer: params[2],
          normalized_answer: params[3],
          note: params[4],
          source: params[5],
          bank_version: params[6],
          mode: params[7],
          session_id: params[8],
          client_id: params[9],
          status: 'pending',
        };
        tables.answer_suggestions.push(row);
        return [row];
      }

      if (sql.startsWith('INSERT INTO dive_sessions')) {
        if (tables.dive_sessions.some(r => r.session_id === params[0])) return [];
        const row = {
          id: seq++,
          session_id: params[0],
          client_id: params[1],
          mode: params[2],
          daily_date: params[3],
          bank_version: params[4],
          score: params[5],
          depth: params[6],
          gems: params[7],
        };
        tables.dive_sessions.push(row);
        return [{ id: row.id }];
      }

      if (sql.startsWith('INSERT INTO round_attempts')) {
        tables.round_attempts.push({
          session_id: params[0],
          question_id: params[5],
          outcome: params[6],
          points: params[10],
          rejected_inputs: JSON.parse(params[12]),
        });
        return [];
      }

      if (sql.startsWith('INSERT INTO rejected_guesses')) {
        tables.rejected_guesses.push({
          session_id: params[0],
          question_id: params[3],
          raw_input: params[4],
          normalized_input: params[5],
          created_at: '2026-11-20T10:00:00.000Z',
        });
        return [];
      }

      if (sql.includes('FROM answer_suggestions') && sql.includes('GROUP BY')) {
        const grouped = new Map();
        for (const r of tables.answer_suggestions) {
          const k = r.question_id + '::' + r.normalized_answer;
          const prev = grouped.get(k) || {
            question_id: r.question_id,
            question_prompt: r.question_prompt,
            sample_answer: r.suggested_answer,
            normalized_answer: r.normalized_answer,
            suggestion_count: 0,
            notes: '',
            last_seen: r.created_at,
          };
          prev.suggestion_count++;
          if (r.note && !prev.notes.includes(r.note)) prev.notes = prev.notes ? prev.notes + ' | ' + r.note : r.note;
          grouped.set(k, prev);
        }
        return [...grouped.values()].sort((a, b) => b.suggestion_count - a.suggestion_count);
      }

      if (sql.includes('FROM answer_suggestions')) {
        return [...tables.answer_suggestions];
      }

      if (sql.startsWith('DELETE FROM rejected_guesses')) {
        const [qId, normIn] = params;
        const before = tables.rejected_guesses.length;
        tables.rejected_guesses = tables.rejected_guesses.filter(r => !(r.question_id === qId && r.normalized_input === normIn));
        return Array.from({ length: before - tables.rejected_guesses.length }, () => ({ ok: true }));
      }

      if (sql.includes('FROM rejected_guesses')) {
        const grouped = new Map();
        for (const r of tables.rejected_guesses) {
          const k = r.question_id + '::' + r.normalized_input;
          const prev = grouped.get(k) || {
            question_id: r.question_id,
            normalized_input: r.normalized_input,
            sample_input: r.raw_input,
            miss_count: 0,
            last_seen: r.created_at,
          };
          prev.miss_count++;
          grouped.set(k, prev);
        }
        return [...grouped.values()].sort((a, b) => b.miss_count - a.miss_count);
      }

      if (sql.startsWith('UPDATE answer_suggestions')) {
        const [nextStatus, qId, normAns] = params;
        const updated = [];
        for (const r of tables.answer_suggestions) {
          if (r.question_id === qId && r.normalized_answer === normAns) {
            r.status = nextStatus;
            updated.push(r);
          }
        }
        return updated;
      }

      if (sql.includes('FROM round_attempts')) {
        return [{ question_id: 'th-isaan-food', plays: tables.round_attempts.length, misses: 0, avg_points: '60.0', avg_rejected_inputs: '1.00' }];
      }

      return [];
    },
  };
}

test('splitSuggestedAnswers splits commas/newlines, normalizes duplicates, and caps at 10', () => {
  const items = splitSuggestedAnswers('ซอยจุ๊, อู๋เพี้ย\n  ซอยจุ๊  \nหมกฮวก; ป่นอึ่ง');
  assert.deepEqual(items.map(i => i.label), ['ซอยจุ๊', 'อู๋เพี้ย', 'หมกฮวก', 'ป่นอึ่ง']);
  const many = splitSuggestedAnswers(Array.from({ length: 15 }, (_, i) => 'เมนู ' + i).join(','));
  assert.equal(many.length, 10);
});

test('ensureSchema runs all DDL statements idempotently', async () => {
  resetSchemaCache();
  const fake = createFakeSql();
  await ensureSchema(fake, { force: true });
  assert.equal(fake.executed.length, SCHEMA_STATEMENTS.length);
  assert.ok(fake.executed.every(e => e.sql.startsWith('CREATE TABLE IF NOT EXISTS') || e.sql.startsWith('CREATE INDEX IF NOT EXISTS')));
});

test('handleCreateSuggestions validates input and stores normalized suggestions in DB', async () => {
  const fake = createFakeSql();
  const bad = await handleCreateSuggestions({ questionId: '' }, fake, { ensure: async () => {} });
  assert.equal(bad.status, 400);

  const ok = await handleCreateSuggestions({
    questionId: 'th-isaan-food',
    questionPrompt: 'ตั้งวงอาหารอีสาน สั่งอะไรดี?',
    suggestedAnswer: 'ก้อยไข่มดแดง, อู๋เพี้ย',
    note: 'เมนูอีสานยอดฮิต',
    source: 'survey',
    bankVersion: '1.0.8',
    mode: 'daily',
    sessionId: 'daily:2026-11-20:1:1000',
    clientId: 'c_test123',
  }, fake, { ensure: async () => {} });

  assert.equal(ok.status, 201);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.saved, 2);
  assert.equal(fake.tables.answer_suggestions.length, 2);
  assert.equal(fake.tables.answer_suggestions[0].suggested_answer, 'ก้อยไข่มดแดง');
  assert.equal(fake.tables.answer_suggestions[0].note, 'เมนูอีสานยอดฮิต');

  const batch = await handleCreateSuggestions({
    items: [
      { questionId: 'th-isaan-food', questionPrompt: 'ตั้งวงอาหารอีสาน', suggestions: ['ตำบักหุ่ง', 'หมกฮวก'], source: 'survey' },
      { questionId: 'world-anime', questionPrompt: 'นึกชื่ออนิเมะ', suggestions: ['Monster'], source: 'rejected-chip' },
    ],
    note: 'ข้อเสนอจากหลายข้อ',
    bankVersion: '1.0.8',
    mode: 'endless',
    sessionId: 'endless:2026-11-20:2:2000',
    clientId: 'c_test123',
  }, fake, { ensure: async () => {} });
  assert.equal(batch.status, 201);
  assert.equal(batch.body.saved, 3);
  assert.equal(batch.body.questionsSaved, 2);
  assert.equal(fake.tables.answer_suggestions.length, 5);
});

test('handleRecordTelemetry stores dive, rounds, rejected guesses and deduplicates session_id', async () => {
  const fake = createFakeSql();
  const payload = {
    sessionId: 'daily:2026-11-20:1:5555',
    clientId: 'c_abc',
    mode: 'daily',
    date: '2026-11-20',
    bankVersion: '1.0.8',
    score: 260,
    depth: 2600,
    gems: 1,
    rounds: [
      {
        questionId: 'th-isaan-food',
        reason: 'correct',
        answerId: 'a1',
        label: 'ส้มตำ',
        tier: 'plankton',
        points: 10,
        elapsedMs: 4200,
        rejectedInputs: ['แจ่วบองปลาร้าสับพิเศษ', '  แจ่วบองปลาร้าสับพิเศษ  ', 'ตำกุ้งเต้น'],
      },
    ],
  };

  const first = await handleRecordTelemetry(payload, fake, { ensure: async () => {} });
  assert.equal(first.status, 201);
  assert.equal(first.body.deduplicated, false);
  assert.equal(first.body.roundsSaved, 1);
  assert.equal(first.body.rejectedSaved, 2);
  assert.equal(fake.tables.rejected_guesses.length, 2);

  const duplicate = await handleRecordTelemetry(payload, fake, { ensure: async () => {} });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.deduplicated, true);
  assert.equal(fake.tables.round_attempts.length, 1);
});

test('handleListSuggestions exports summary JSON and UTF-8 BOM CSV cleanly', async () => {
  const fake = createFakeSql();
  await handleCreateSuggestions({
    questionId: 'th-isaan-food',
    questionPrompt: 'ตั้งวงอาหารอีสาน สั่งอะไรดี?',
    suggestedAnswer: 'ตำซั่ว, หมกฮวก',
    note: 'ควรมีในคลัง, อร่อยมาก',
  }, fake, { ensure: async () => {} });
  await handleCreateSuggestions({
    questionId: 'th-isaan-food',
    questionPrompt: 'ตั้งวงอาหารอีสาน สั่งอะไรดี?',
    suggestedAnswer: 'ตำซั่ว',
  }, fake, { ensure: async () => {} });

  const summary = await handleListSuggestions({ view: 'summary', format: 'json' }, fake, { ensure: async () => {} });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.suggestions[0].sample_answer, 'ตำซั่ว');
  assert.equal(summary.body.suggestions[0].suggestion_count, 2);

  const csv = await handleListSuggestions({ view: 'summary', format: 'csv' }, fake, { ensure: async () => {} });
  assert.equal(csv.status, 200);
  assert.equal(csv.contentType, 'text/csv; charset=utf-8');
  assert.ok(csv.body.startsWith('\uFEFFquestion_id,question_prompt'));
  assert.ok(csv.body.includes('"ควรมีในคลัง, อร่อยมาก"'));
});

test('admin token verification and bearer extraction enforce exact constant-time checks', () => {
  assert.equal(verifyAdminToken('secret-123', 'secret-123'), true);
  assert.equal(verifyAdminToken('secret-124', 'secret-123'), false);
  assert.equal(verifyAdminToken('short', 'secret-123'), false);
  assert.equal(verifyAdminToken('', 'secret-123'), false);
  assert.equal(verifyAdminToken('secret-123', ''), false);
  assert.equal(extractBearerToken({ headers: { authorization: 'Bearer my-tok' } }), 'my-tok');
  assert.equal(extractBearerToken({ headers: {}, query: { token: 'q-tok' } }), 'q-tok');
  assert.ok(toCsv([{ a: '1,2', b: 'x"y' }], ['a', 'b']).includes('"1,2","x""y"'));
});

test('gameplay tracks unique rejected guesses per round and clientId persists cleanly', async () => {
  const bank = prepareSurveyBank(JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8')));
  const now = 1794888000000;
  let s = createSession({ mode: 'daily', bank, questions: selectDaily(bank, '2026-11-20'), date: '2026-11-20', now });
  s = tickSession(s, now + PREVIEW_MS);
  s = submitAnswer(s, 'คำตอบมั่วหนึ่ง', {}, now + PREVIEW_MS + 500);
  s = submitAnswer(s, '  คำตอบมั่วหนึ่ง  ', {}, now + PREVIEW_MS + 900);
  s = submitAnswer(s, 'คำตอบมั่วสอง', {}, now + PREVIEW_MS + 1200);
  assert.deepEqual(s.rejectedInputs, ['คำตอบมั่วหนึ่ง', 'คำตอบมั่วสอง']);

  const validAnswer = s.questions[0].answers[0].label;
  s = submitAnswer(s, validAnswer, {}, now + PREVIEW_MS + 1500);
  assert.deepEqual(s.results[0].rejectedInputs, ['คำตอบมั่วหนึ่ง', 'คำตอบมั่วสอง']);
  assert.deepEqual(s.rejectedInputs, []);
  s = tickSession(s, s.phaseUntil);
  s = nextRound(s, s.phaseUntil + 10);
  assert.deepEqual(s.rejectedInputs, []);

  const save = emptySave();
  const id1 = ensureClientId(save);
  const id2 = ensureClientId(save);
  assert.ok(id1.startsWith('c_'));
  assert.equal(id1, id2);
});

test('handleAdminAction updates suggestion status, deletes rejected rows, and rejects invalid payloads', async () => {
  const fake = createFakeSql();
  await handleCreateSuggestions({
    questionId: 'th-pets',
    questionPrompt: 'ถ้าจะมีสัตว์เลี้ยง นึกถึงตัวอะไร?',
    suggestedAnswer: 'ลิง',
  }, fake, { ensure: async () => {} });
  await handleRecordTelemetry({
    sessionId: 'daily:2026-11-23:1:7777',
    clientId: 'c_admin',
    mode: 'daily',
    date: '2026-11-23',
    bankVersion: '1.1.0',
    score: 100,
    depth: 1000,
    gems: 0,
    rounds: [{ questionId: 'world-board-games', reason: 'timeout', points: 0, elapsedMs: 30000, rejectedInputs: ['อั้ยยยะ'] }],
  }, fake, { ensure: async () => {} });

  const bad = await handleAdminAction({ action: 'unknown-op' }, fake, { ensure: async () => {} });
  assert.equal(bad.status, 400);

  const upd = await handleAdminAction({
    action: 'suggestion-status',
    status: 'added',
    questionId: 'th-pets',
    normalizedAnswer: 'ลิง',
  }, fake, { ensure: async () => {} });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.ok, true);
  assert.equal(fake.tables.answer_suggestions[0].status, 'added');

  const del = await handleAdminAction({
    action: 'delete-rejected',
    questionId: 'world-board-games',
    normalizedInput: fake.tables.rejected_guesses[0].normalized_input,
  }, fake, { ensure: async () => {} });
  assert.equal(del.status, 200);
  assert.equal(del.body.ok, true);
  assert.equal(fake.tables.rejected_guesses.length, 0);

  const meta = JSON.parse(await readFile(new URL('../data/question-meta.json', import.meta.url), 'utf8'));
  const dash = await handleAdminDashboard({ days: '7', limit: '25' }, fake, meta, { ensure: async () => {} });
  assert.equal(dash.status, 200);
  assert.equal(dash.body.ok, true);
  assert.equal(dash.body.bankMetaCount, 256);
});
