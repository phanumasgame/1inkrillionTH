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
import { researchRecommendations, suggestTierFromMetrics } from '../db/research.js';
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

const fixtureCurated = {
  basis: 'test',
  coverage: 'test',
  tierReasons: { plankton: 'test', schooler: 'test', rare: 'test', deepcut: 'test', krillion: 'test' },
};
const padAnswers = (list, prefix) => {
  const out = [...list];
  while (out.length < 21) out.push({ id: `${prefix}-pad-${out.length}`, label: `รายการเสริม${prefix}${out.length}`, aliases: [], tier: 'rare' });
  return out;
};
const fixtureBank = {
  version: 'fixture-1.0',
  scoringMethod: 'hybrid-survey-and-curated-v1',
  questions: [
    {
      id: 'th-isaan-food',
      scope: 'thai',
      theme: 'food',
      prompt: 'ตั้งวงอาหารอีสาน สั่งอะไรดี?',
      hint: 'เช่น ส้มตำ',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'is1', label: 'ซอยจุ๊', aliases: [], tier: 'plankton' },
        { id: 'is2', label: 'ลาบหมู', aliases: [], tier: 'plankton' },
        { id: 'is3', label: 'อู๋เพี้ย', aliases: [], tier: 'deepcut' },
        { id: 'is4', label: 'ต้มแซ่บ', aliases: [], tier: 'schooler' },
        { id: 'is5', label: 'หมกฮวก', aliases: [], tier: 'krillion' },
      ], 'is'),
    },
    {
      id: 'th-temples',
      scope: 'thai',
      theme: 'places',
      prompt: 'นึกชื่อวัดในไทยสักวัด!',
      hint: 'เช่น วัดพระแก้ว',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'tm1', label: 'วัดบวรนิเวศ', aliases: ['วัดบวรนิเวศราชวรวิหาร'], tier: 'plankton' },
        { id: 'tm2', label: 'วัดโพธิ์', aliases: [], tier: 'plankton' },
        { id: 'tm3', label: 'วัดอรุณ', aliases: [], tier: 'schooler' },
        { id: 'tm4', label: 'วัดมหาบุศย์', aliases: [], tier: 'rare' },
        { id: 'tm5', label: 'วัดถ้ำผาปล่อง', aliases: [], tier: 'krillion' },
      ], 'tm'),
    },
    {
      id: 'world-sushi',
      scope: 'world',
      theme: 'food',
      prompt: 'ไปร้านซูชิ สั่งคำไหนดี?',
      hint: 'เช่น แซลมอน',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'su1', label: 'ปลาซาบะ', aliases: [], tier: 'schooler' },
        { id: 'su2', label: 'แซลมอน', aliases: [], tier: 'plankton' },
        { id: 'su3', label: 'ทูน่า', aliases: [], tier: 'plankton' },
        { id: 'su4', label: 'อุนิ', aliases: [], tier: 'rare' },
        { id: 'su5', label: 'เอนกาวะ', aliases: [], tier: 'krillion' },
      ], 'su'),
    },
    {
      id: 'world-coffee-orders',
      scope: 'world',
      theme: 'food',
      prompt: 'เข้าร้านกาแฟ สั่งเมนูอะไรดี?',
      hint: 'เช่น ลาเต้',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'cf1', label: 'อเมริกาโน่', aliases: [], tier: 'plankton' },
        { id: 'cf2', label: 'ลาเต้', aliases: [], tier: 'plankton' },
        { id: 'cf3', label: 'คาปูชิโน่', aliases: [], tier: 'schooler' },
        { id: 'cf4', label: 'เอสเปรสโซ่', aliases: [], tier: 'rare' },
        { id: 'cf5', label: 'เดอร์ตี้', aliases: [], tier: 'krillion' },
      ], 'cf'),
    },
    {
      id: 'world-cat-breeds',
      scope: 'world',
      theme: 'animals',
      prompt: 'นึกชื่อพันธุ์แมวสักพันธุ์!',
      hint: 'เช่น เปอร์เซีย',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'ct1', label: 'เปอร์เซีย', aliases: [], tier: 'plankton' },
        { id: 'ct2', label: 'วิเชียรมาศ', aliases: [], tier: 'schooler' },
        { id: 'ct3', label: 'สกอตติชโฟลด์', aliases: [], tier: 'rare' },
        { id: 'ct4', label: 'เบงกอล', aliases: [], tier: 'deepcut' },
        { id: 'ct5', label: 'ขาวมณี', aliases: [], tier: 'krillion' },
      ], 'ct'),
    },
    {
      id: 'world-famous-movies',
      scope: 'world',
      theme: 'screen',
      prompt: 'นึกชื่อหนังดังสักเรื่อง!',
      hint: 'เช่น Titanic',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'mv1', label: 'Titanic', aliases: [], tier: 'plankton' },
        { id: 'mv2', label: 'Inception', aliases: [], tier: 'plankton' },
        { id: 'mv3', label: 'Avatar', aliases: [], tier: 'schooler' },
        { id: 'mv4', label: 'Interstellar', aliases: [], tier: 'rare' },
        { id: 'mv5', label: 'Parasite', aliases: [], tier: 'krillion' },
      ], 'mv'),
    },
    {
      id: 'world-famous-cities',
      scope: 'world',
      theme: 'places',
      prompt: 'นึกชื่อเมืองดังทั่วโลกสักเมือง!',
      hint: 'เช่น โตเกียว',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'ci1', label: 'คูมาโมโตะ', aliases: ['Kumamoto'], tier: 'deepcut' },
        { id: 'ci2', label: 'โตเกียว', aliases: [], tier: 'plankton' },
        { id: 'ci3', label: 'ปารีส', aliases: [], tier: 'plankton' },
        { id: 'ci4', label: 'ลอนดอน', aliases: [], tier: 'schooler' },
        { id: 'ci5', label: 'ซัปโปโร', aliases: [], tier: 'krillion' },
      ], 'ci'),
    },
    {
      id: 'world-cartoon-characters',
      scope: 'world',
      theme: 'screen',
      prompt: 'นึกชื่อตัวการ์ตูนสักตัว!',
      hint: 'เช่น โดราเอมอน',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'cc1', label: 'โกดะ ทาเคชิ', aliases: ['Takeshi Goda'], tier: 'rare' },
        { id: 'cc2', label: 'โดราเอมอน', aliases: [], tier: 'plankton' },
        { id: 'cc3', label: 'โนบิตะ', aliases: [], tier: 'plankton' },
        { id: 'cc4', label: 'ปิกาจู', aliases: [], tier: 'schooler' },
        { id: 'cc5', label: 'ลูฟี่', aliases: [], tier: 'krillion' },
      ], 'cc'),
    },
    {
      id: 'world-animation-films',
      scope: 'world',
      theme: 'screen',
      prompt: 'เลือกหนังแอนิเมชันมาดูสักเรื่อง',
      hint: 'เช่น Toy Story',
      curated: fixtureCurated,
      answers: padAnswers([
        { id: 'af1', label: 'วอลล์อี', aliases: ['WALL-E', 'wall e'], tier: 'plankton' },
        { id: 'af2', label: 'Toy Story', aliases: [], tier: 'plankton' },
        { id: 'af3', label: 'Spirited Away', aliases: [], tier: 'schooler' },
        { id: 'af4', label: 'Up', aliases: [], tier: 'rare' },
        { id: 'af5', label: 'Kubo', aliases: [], tier: 'krillion' },
      ], 'af'),
    },
  ],
};
const fixtureById = new Map(fixtureBank.questions.map(q => [q.id, q]));

test('findAliasTargetInQuestion and buildAdditionPlan cleanly separate New Answers vs New Aliases', () => {
  const templeAlias = findAliasTargetInQuestion(fixtureById.get('th-temples'), 'วัดบวรนิเวศวิหาร');
  assert.equal(templeAlias?.answer?.label, 'วัดบวรนิเวศ');

  const prefixAlias = findAliasTargetInQuestion(fixtureById.get('world-sushi'), 'ซาบะ');
  assert.equal(prefixAlias?.answer?.label, 'ปลาซาบะ');

  const plan = buildAdditionPlan(
    fixtureBank,
    fixtureById,
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

  const report = await generateDailyAnalysis(fakeSql, fixtureBank, { date: '2026-11-20', ensure: async () => {} });
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

test('suggestTierFromMetrics and researchRecommendations promote redirects and calibrate tiers', async () => {
  assert.equal(suggestTierFromMetrics('thai', { thPv: 8000, hasArticle: true }), 'plankton');
  assert.equal(suggestTierFromMetrics('thai', { thPv: 2000, hasArticle: true }), 'schooler');
  assert.equal(suggestTierFromMetrics('world', { wdSitelinks: 75, thPv: 500, hasArticle: true }), 'plankton');
  assert.equal(suggestTierFromMetrics('world', { wdSitelinks: 18, thPv: 100, hasArticle: true }), 'rare');

  const fakeFetch = async rawUrl => {
    const url = decodeURIComponent(rawUrl);
    if (url.includes('th.wikipedia.org') && url.includes('redirects=1')) {
      const qs = new URL(rawUrl).searchParams.get('titles') || '';
      if (qs.includes('ไจเอ้น')) {
        return {
          ok: true,
          async json() {
            return {
              query: {
                redirects: [{ from: 'ไจเอ้น', to: 'โกดะ ทาเคชิ' }],
                pages: {
                  101: { pageid: 101, title: 'โกดะ ทาเคชิ', pageviews: { '2026-11-19': 2500 }, langlinkscount: 18, description: 'ตัวละครการ์ตูน' },
                },
              },
            };
          },
        };
      }
      if (qs.includes('คุมาโมโต้')) {
        return {
          ok: true,
          async json() {
            return {
              query: {
                pages: {
                  202: { pageid: 202, title: 'คุมาโมโตะ', pageviews: { '2026-11-19': 1800 }, langlinkscount: 72, description: 'นครในประเทศญี่ปุ่น' },
                },
              },
            };
          },
        };
      }
      if (qs.includes('วอลล์อี')) {
        return {
          ok: true,
          async json() {
            return {
              query: {
                pages: {
                  303: { pageid: 303, title: 'วอลล์-อี', pageviews: { '2026-11-19': 5500 }, langlinkscount: 97, description: 'ภาพยนตร์แอนิเมชัน' },
                },
              },
            };
          },
        };
      }
      return { ok: true, async json() { return { query: { pages: { '-1': { missing: '' } } } }; } };
    }
    if (url.includes('wikidata.org') && url.includes('wbsearchentities')) {
      if (url.includes('คุมาโมโต้')) {
        return { ok: true, async json() { return { search: [{ id: 'Q199889', label: 'คุมาโมโตะ', description: 'city in Japan' }] }; } };
      }
      if (url.includes('วอลล์อี')) {
        return { ok: true, async json() { return { search: [{ id: 'Q104905', label: 'วอลล์อี', description: '2008 animated film' }] }; } };
      }
      return { ok: true, async json() { return { search: [] }; } };
    }
    if (url.includes('wikidata.org') && url.includes('wbgetentities')) {
      if (url.includes('Q104905')) {
        return {
          ok: true,
          async json() {
            return {
              entities: {
                Q104905: {
                  labels: { th: { value: 'วอลล์อี' }, en: { value: 'WALL-E' } },
                  descriptions: { en: { value: '2008 animated film' } },
                  sitelinks: Object.fromEntries(Array.from({ length: 97 }, (_, i) => [`w${i}`, {}])),
                },
              },
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            entities: {
              Q199889: {
                labels: { th: { value: 'คุมาโมโตะ' }, en: { value: 'Kumamoto' } },
                descriptions: { en: { value: 'city in Kumamoto prefecture, Japan' } },
                sitelinks: Object.fromEntries(Array.from({ length: 72 }, (_, i) => [`w${i}`, {}])),
              },
            },
          };
        },
      };
    }
    return { ok: true, async json() { return {}; } };
  };

  const mockReport = {
    recommendations: {
      newAnswers: [
        { questionId: 'world-cartoon-characters', prompt: 'ตัวการ์ตูน', label: 'ไจเอ้น', submittedText: 'ไจเอ้น', suggestedAliases: [], suggestedTier: 'rare', sources: 'rejected(1)' },
        { questionId: 'world-famous-cities', prompt: 'เมืองดัง', label: 'คุมาโมโต้', submittedText: 'คุมาโมโต้', suggestedAliases: [], suggestedTier: 'rare', sources: 'rejected(1)' },
        { questionId: 'world-famous-movies', prompt: 'หนังต่างประเทศ', label: 'วอลล์อี', submittedText: 'วอลล์อี', suggestedAliases: [], suggestedTier: 'rare', sources: 'rejected(1)' },
        { questionId: 'world-coffee-orders', prompt: 'กาแฟ', label: 'อเมริกาโน่ส้ม', submittedText: 'อเมริกาโน่ส้ม', suggestedAliases: [], suggestedTier: 'rare', sources: 'survey(1)' },
      ],
      newAliases: [],
      reviewOrSkip: [],
    },
  };

  const researched = await researchRecommendations(mockReport, fixtureBank, { fetchFn: fakeFetch });
  // Redirect and canonical Wikidata match auto-promote to New Aliases
  assert.equal(researched.recommendations.newAliases.some(a => a.alias === 'ไจเอ้น' && a.targetLabel === 'โกดะ ทาเคชิ'), true);
  assert.equal(researched.recommendations.newAliases.some(a => a.alias === 'คุมาโมโต้' && a.targetLabel === 'คูมาโมโตะ'), true);
  const wallE = researched.recommendations.newAnswers.find(a => a.label === 'วอลล์อี');
  assert.equal(wallE?.researchedTier, 'plankton');
  const orangeCoffee = researched.recommendations.newAnswers.find(a => a.label === 'อเมริกาโน่ส้ม');
  assert.equal(orangeCoffee?.evidenceSummary?.needsWebVerify, true);
});
