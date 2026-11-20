import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bangkokDateString,
  buildAdditionPlan,
  checkBankCoverage,
  findAliasTargetInQuestion,
  formatDailyReportMarkdown,
  generateDailyAnalysis,
} from '../db/analytics.js';
import { prepareSurveyBank } from '../src/survey.js';

const rawBank = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(rawBank);
const byId = new Map(bank.questions.map(q => [q.id, q]));

test('bangkokDateString formats Asia/Bangkok date cleanly', () => {
  const d = new Date('2026-11-20T18:30:00.000Z'); // 2026-11-21 01:30 BKK
  assert.equal(bangkokDateString(d), '2026-11-21');
});

test('checkBankCoverage distinguishes covered, close, missing, and unknown questions', () => {
  const exact = checkBankCoverage(byId, 'th-isaan-food', 'ซอยจุ๊');
  assert.equal(exact.status, 'covered');
  assert.ok(exact.matchedTier);

  const missing = checkBankCoverage(byId, 'th-isaan-food', 'เมนูสมมติไม่มีจริง999');
  assert.equal(missing.status, 'missing');

  const unknownQ = checkBankCoverage(byId, 'no-such-q', 'anything');
  assert.equal(unknownQ.status, 'unknown_question');
});

test('findAliasTargetInQuestion and buildAdditionPlan cleanly separate New Answers vs New Aliases', () => {
  const templeAlias = findAliasTargetInQuestion(byId.get('th-temples'), 'วัดบวรนิเวศวิหาร');
  assert.equal(templeAlias?.answer?.label, 'วัดบวรนิเวศ');

  const prefixAlias = findAliasTargetInQuestion(byId.get('world-sushi'), 'ซาบะ');
  assert.equal(prefixAlias?.answer?.label, 'ปลาซาบะ');

  const plan = buildAdditionPlan(
    bank,
    byId,
    [
      { question_id: 'th-temples', sample_answer: 'วัดบวรนิเวศวิหาร', total_count: 1, today_count: 1, latest_version: '1.0.9', notes: '' },
      { question_id: 'world-coffee-orders', sample_answer: 'อเมริกาโน่น้ำผึ้ง', total_count: 2, today_count: 2, latest_version: '1.0.9', notes: '' },
    ],
    [
      { question_id: 'world-sushi', sample_input: 'ซาบะ', total_count: 1, today_count: 1, latest_version: '1.0.9' },
      { question_id: 'world-cat-breeds', sample_input: 'ก', total_count: 1, today_count: 1, latest_version: '1.0.9' },
      { question_id: 'world-famous-movies', sample_input: 'wall e', total_count: 1, today_count: 1, latest_version: '1.0.9' },
      { question_id: 'world-famous-movies', sample_input: 'wale e', total_count: 1, today_count: 1, latest_version: '1.0.9' },
    ]
  );

  assert.equal(plan.newAliases.some(a => a.alias === 'วัดบวรนิเวศวิหาร' && a.targetLabel === 'วัดบวรนิเวศ'), true);
  assert.equal(plan.newAliases.some(a => a.alias === 'ซาบะ' && a.targetLabel === 'ปลาซาบะ'), true);
  assert.equal(plan.newAnswers.some(a => a.questionId === 'world-coffee-orders' && a.label === 'อเมริกาโน่น้ำผึ้ง'), true);
  assert.equal(plan.newAnswers.some(a => a.questionId === 'world-famous-movies' && /วอลล์อี/.test(a.label)), true);
  assert.equal(plan.reviewOrSkip.some(s => s.sample === 'ก'), true);
  assert.equal(plan.reviewOrSkip.some(s => s.sample === 'wale e'), true);
});

test('generateDailyAnalysis queries all tables and cross-checks against live bank', async () => {
  const calls = [];
  const fakeSql = {
    async query(sqlText, params = []) {
      const q = sqlText.replace(/\s+/g, ' ').trim();
      calls.push({ q, params });
      if (q.includes('MAX(score)') && q.includes('FROM dive_sessions')) {
        return [{
          today_sessions: 2, today_players: 2, today_avg_score: '175.0', today_max_score: 210,
          today_avg_depth: 1750, today_gems: 1, today_daily: 1, today_endless: 1,
          total_sessions: 6, total_players: 4, total_avg_score: '147.5', total_max_score: 290,
          total_avg_depth: 1475, total_gems: 2, total_daily: 2, total_endless: 4,
        }];
      }
      if (q.includes('FROM dive_sessions') && q.includes('bank_version')) {
        return [{ bank_version: '1.0.9', sessions: 2, today_sessions: 2, avg_score: '175.0', gems: 1 }];
      }
      if (q.includes('FROM dive_sessions') && q.includes('AS day')) {
        return [{ day: '2026-11-20', sessions: 2, players: 2, avg_score: '175.0', gems: 1 }];
      }
      if (q.includes('FROM round_attempts') && q.includes('today_rounds')) {
        return [{
          today_rounds: 14, today_hits: 11, today_skips: 1, today_timeouts: 2, today_krillions: 1, today_avg_ms: 8200,
          total_rounds: 42, total_hits: 30, total_skips: 2, total_timeouts: 10, total_krillions: 2, total_avg_ms: 9100,
        }];
      }
      if (q.includes('FROM round_attempts') && q.includes('AS bucket')) {
        return [
          { bucket: 'plankton', total_count: 20, today_count: 7, avg_ms: 5100 },
          { bucket: 'timeout', total_count: 10, today_count: 2, avg_ms: 25000 },
        ];
      }
      if (q.includes('FROM round_attempts') && q.includes('avg_rejected')) {
        return [
          { question_id: 'th-isaan-food', plays: 4, today_plays: 2, misses: 2, krillions: 0, avg_points: '20.0', avg_ms: 14000, avg_rejected: '1.50' },
        ];
      }
      if (q.includes('FROM answer_suggestions') && q.includes('pending_rows')) {
        return [{ today_rows: 1, total_rows: 50, questions_with_suggestions: 5, pending_rows: 50 }];
      }
      if (q.includes('FROM answer_suggestions') && q.includes('GROUP BY')) {
        return [
          {
            question_id: 'th-isaan-food', question_prompt: 'ตั้งวงอาหารอีสาน สั่งอะไรดี?',
            sample_answer: 'ซอยจุ๊', normalized_answer: 'ซอยจุ๊',
            total_count: 3, today_count: 1, latest_version: '1.0.9', source: 'survey', notes: '', last_seen: '2026-11-20T12:00:00Z',
          },
          {
            question_id: 'world-sushi', question_prompt: 'ไปร้านซูชิ',
            sample_answer: 'เอ็นกาวะสูตรพิเศษ999', normalized_answer: 'เอ็นกาวะสูตรพิเศษ999',
            total_count: 2, today_count: 2, latest_version: '1.0.9', source: 'survey', notes: 'test', last_seen: '2026-11-20T12:00:00Z',
          },
        ];
      }
      if (q.includes('FROM rejected_guesses') && q.includes('unique_misses')) {
        return [{ today_rows: 4, total_rows: 14, unique_misses: 14 }];
      }
      if (q.includes('FROM rejected_guesses') && q.includes('GROUP BY')) {
        return [
          {
            question_id: 'world-sushi', normalized_input: 'ซาบะ', sample_input: 'ซาบะ',
            total_count: 1, today_count: 1, latest_version: '1.0.9', last_seen: '2026-11-20T12:00:00Z',
          },
        ];
      }
      return [];
    },
  };

  const report = await generateDailyAnalysis(fakeSql, bank, { date: '2026-11-20', ensure: async () => {} });
  assert.equal(report.date, '2026-11-20');
  assert.equal(report.sessions.overview.today_sessions, 2);
  assert.equal(report.suggestions.covered.length, 1);
  assert.equal(report.suggestions.actionable.length, 1);
  assert.equal(report.rejected.actionable.length, 1);
  assert.ok(report.insights.length >= 2);

  const md = formatDailyReportMarkdown(report);
  assert.match(md, /dive_sessions/);
  assert.match(md, /answer_suggestions/);
  assert.match(md, /rejected_guesses/);
  assert.match(md, /ซาบะ/);
});
