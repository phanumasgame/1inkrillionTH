import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import adminHandler from '../api/admin.js';
import {
  ANSWER_MS,
  DIVE_GROUPS,
  PREVIEW_MS,
  createSession,
  filterQuestionsByGroup,
  getDiveGroup,
  matchAnswer,
  selectEndless,
  tickSession,
} from '../src/game.js';
import { currentSavedSession, emptySave, endlessSlot, prepareSaveForBank, readSave, writeSave } from '../src/storage.js';
import { prepareSurveyBank } from '../src/survey.js';

const rawBank = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(rawBank);
const byId = new Map(bank.questions.map(q => [q.id, q]));

test('V1.1.0 sets thinking timer to 30 seconds', () => {
  assert.equal(ANSWER_MS, 30_000);
  const now = 1_795_000_000_000;
  const pick = selectEndless(bank, [], Math.random, 1, 'classic');
  let s = createSession({ mode: 'daily', bank, questions: pick.questions, date: '2026-11-23', now });
  s = tickSession(s, now + PREVIEW_MS);
  assert.equal(s.phase, 'answer');
  assert.equal(s.deadline - (now + PREVIEW_MS), 30_000);

  s = tickSession(s, now + PREVIEW_MS + 29_999);
  assert.equal(s.phase, 'answer');

  s = tickSession(s, now + PREVIEW_MS + 30_000);
  assert.equal(s.phase, 'sinking');
  assert.equal(s.results[0].reason, 'timeout');
});

test('V1.1.0 Expedition Dive Groups filter themes cleanly and select balanced 7-round dives', () => {
  assert.equal(DIVE_GROUPS.length, 6);
  for (const g of DIVE_GROUPS) {
    assert.equal(getDiveGroup(g.id).id, g.id);
    const pool = filterQuestionsByGroup(bank.questions, g.id);
    const minPool = g.id === 'football' ? 15 : 20;
    assert.ok(pool.length >= minPool, `${g.id} pool too small (${pool.length})`);
    const dive = selectEndless(bank, [], () => 0.37, 1, g.id);
    assert.equal(dive.questions.length, 7);
    assert.equal(new Set(dive.questions.map(q => q.id)).size, 7);
    if (g.filter) {
      assert.ok(dive.questions.every(q => g.filter(q)), `${g.id} picked off-filter question`);
    } else if (g.themes) {
      assert.ok(dive.questions.every(q => g.themes.includes(q.theme)), `${g.id} picked off-theme question`);
    }
    const thaiCount = dive.questions.filter(q => q.scope === 'thai').length;
    assert.ok(thaiCount >= 2 && thaiCount <= 5, `${g.id} scope balance unexpected: ${thaiCount} thai`);
  }
});

test('V1.1.0 storage tracks per-group endless slots cleanly', () => {
  const prevStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  try {
    const now = 1_795_000_000_000;
    let save = emptySave();
    save.currentBankVersion = bank.version;
    const entPick = selectEndless(bank, [], Math.random, 1, 'entertainment');
    const entSession = createSession({
      mode: 'endless',
      group: 'entertainment',
      bank,
      questions: entPick.questions,
      date: '2026-11-23',
      now,
    });
    save.endlessByBank[endlessSlot(bank.version, 'entertainment')] = entSession;
    save.runByGroup.entertainment = 1;
    writeSave(save);
    const loaded = prepareSaveForBank(readSave(), bank);
    const resumed = currentSavedSession(loaded, 'endless', '2026-11-23', bank.version, 'entertainment');
    assert.equal(resumed?.group, 'entertainment');
    assert.equal(resumed?.questions?.length, 7);
    const classicResumed = currentSavedSession(loaded, 'endless', '2026-11-23', bank.version, 'classic');
    assert.equal(classicResumed, null);
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('V1.1.0 upgraded alias & fuzzy matcher handles Postgres real misses and avoids false positives', () => {
  assert.equal(matchAnswer(byId.get('world-kpop-jpop-asian-artists'), 'aspa')?.answer?.label, 'aespa');
  assert.equal(matchAnswer(byId.get('world-athletes'), 'เมนี่ปาเกียว')?.answer?.label, 'แมนนี ปาเกียว');
  assert.equal(matchAnswer(byId.get('world-landmarks'), 'หอเอนปีซ่า')?.answer?.label, 'หอเอนเมืองปิซา');
  assert.equal(matchAnswer(byId.get('world-fictional-characters'), 'Spiderman')?.answer?.label, 'สไปเดอร์แมน');
  assert.equal(matchAnswer(byId.get('world-tech-apps'), 'x')?.answer?.label, 'เอ็กซ์');
  assert.equal(matchAnswer(byId.get('world-strategy-sim-indie-games'), 'warcaief')?.answer?.label, 'Warcraft');
  assert.equal(matchAnswer(byId.get('world-planets-space'), 'ton618')?.answer?.label, 'TON 618');
  assert.equal(matchAnswer(byId.get('world-action-rpg-games'), 'shinmegamitensei')?.answer?.label, 'Shin Megami Tensei');
  assert.equal(matchAnswer(byId.get('th-famous-people'), 'gaga')?.kind, 'unknown');
});

test('V1.1.0 bank fixes V13 pools, zero-Thai world questions, adds 20 mainstream questions & lightweight question-meta', async () => {
  const worldNonWordle = bank.questions.filter(q => q.scope === 'world' && !q.id.startsWith('world-wordle'));
  for (const q of worldNonWordle) {
    const thCount = q.answers.filter(a => /[ก-๙]/.test(a.label) || (a.aliases || []).some(al => /[ก-๙]/.test(al))).length;
    assert.ok(thCount > 0, `${q.id} still has 0 Thai aliases`);
  }

  assert.equal(matchAnswer(byId.get('world-cities-starting-s-m-b-c'), 'Cairo')?.answer?.label, 'ไคโร');
  assert.equal(matchAnswer(byId.get('world-cities-starting-s-m-b-c'), 'Milan')?.answer?.label, 'มิลาน');
  assert.equal(matchAnswer(byId.get('world-commercial-and-game-fish'), 'ทูน่า')?.answer?.label, 'ปลาทูน่า');
  assert.equal(matchAnswer(byId.get('world-board-games'), 'อูโน่')?.answer?.label, 'อูโน่');
  assert.equal(matchAnswer(byId.get('world-board-games'), 'โอจา')?.answer?.label, 'กระดานผีถ้วยแก้ว');
  assert.equal(matchAnswer(byId.get('th-temples-north'), 'วัดพระธาตุดอยสุเทพ')?.answer?.tier, 'plankton');
  assert.equal(matchAnswer(byId.get('th-temples-north'), 'วัดพระแก้ว')?.kind, 'unknown');
  assert.equal(matchAnswer(byId.get('th-temples-isaan'), 'วัดสีสะเกด')?.kind, 'unknown');

  const newIds = [
    ['world-harry-potter-characters', 'Hermione Granger'],
    ['world-one-piece-characters', 'ลูฟี่'],
    ['world-marvel-mcu-characters', 'ไอรอนแมน'],
    ['world-disney-pixar-characters', 'Elsa'],
    ['world-naruto-characters', 'นารูโตะ'],
    ['world-dragonball-characters', 'โกคู'],
    ['world-conan-characters', 'จอมโจรคิด'],
    ['world-doraemon-characters', 'โดราเอมอน'],
    ['world-starwars-characters', 'Darth Vader'],
    ['world-lotr-characters', 'Gandalf'],
    ['world-minecraft-items-mobs', 'ครีปเปอร์'],
    ['world-sanrio-characters', 'คุโรมิ'],
    ['world-lol-champions', 'Yasuo'],
    ['world-valorant-overwatch-heroes', 'Jett'],
    ['th-ramakien-characters', 'ทศกัณฐ์'],
    ['th-phra-aphai-khun-chang-chars', 'สุดสาคร'],
    ['th-rov-heroes', 'Murad'],
    ['th-online-mobile-games', 'Free Fire'],
    ['th-gdh-gth-films', 'ฉลาดเกมส์โกง'],
    ['th-famous-dramas-characters', 'ลำยอง'],
    ['th-bnk-tpops-groups', '4EVE'],
    ['th-thai-comedians-youtubers', 'น้าค่อม'],
    ['th-thai-league-football-clubs', 'บุรีรัมย์'],
    ['th-markets-nightmarkets', 'จตุจักร'],
  ];
  for (const [id, probe] of newIds) {
    const q = byId.get(id);
    assert.ok(q, `Missing new V1.1.0 question: ${id}`);
    assert.equal(matchAnswer(q, probe)?.kind, 'exact', `Probe "${probe}" did not exact match in ${id}`);
  }

  const meta = JSON.parse(await readFile(new URL('../data/question-meta.json', import.meta.url), 'utf8'));
  assert.equal(meta.length, bank.questions.length);
  assert.equal(meta[0].id, bank.questions[0].id);
});

test('/api/admin handler enforces database & token auth guards', async () => {
  const prevDb = process.env.DATABASE_URL;
  const prevTok = process.env.ADMIN_TOKEN;
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_TOKEN;
  const makeRes = () => {
    const res = { statusCode: 200, headers: {}, body: null };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = c => { res.statusCode = c; return res; };
    res.json = b => { res.body = b; return res; };
    res.end = () => res;
    return res;
  };
  try {
    const r503 = makeRes();
    await adminHandler({ method: 'GET', headers: {}, url: '/api/admin' }, r503);
    assert.equal(r503.statusCode, 503);

    process.env.DATABASE_URL = 'postgres://fake:fake@localhost/db';
    process.env.ADMIN_TOKEN = 'top-secret-token';
    const r401 = makeRes();
    await adminHandler({ method: 'GET', headers: { authorization: 'Bearer wrong' }, url: '/api/admin' }, r401);
    assert.equal(r401.statusCode, 401);
    assert.equal(r401.headers['X-Robots-Tag'], 'noindex, nofollow');
  } finally {
    if (prevDb !== undefined) process.env.DATABASE_URL = prevDb;
    else delete process.env.DATABASE_URL;
    if (prevTok !== undefined) process.env.ADMIN_TOKEN = prevTok;
    else delete process.env.ADMIN_TOKEN;
  }
});
