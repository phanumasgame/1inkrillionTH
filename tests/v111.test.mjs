import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { normalize } from '../src/answers.js';
import {
  DIVE_GROUPS,
  filterQuestionsByGroup,
  getDiveGroup,
  matchAnswer,
  selectEndless,
} from '../src/game.js';
import { emptySave, prepareSaveForBank, readSave, writeSave } from '../src/storage.js';
import { prepareSurveyBank } from '../src/survey.js';

const rawBank = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(rawBank);
const byId = new Map(bank.questions.map(q => [q.id, q]));

test('V1.1.1 Krillion Football Dive Group has 15 questions (7 TH / 8 World) and runs balanced dives', () => {
  const football = getDiveGroup('football');
  assert.equal(football.id, 'football');
  assert.equal(football.route, '/unlimited/football');
  assert.ok(DIVE_GROUPS.some(g => g.id === 'football'));

  const pool = filterQuestionsByGroup(bank.questions, 'football');
  assert.equal(pool.length, 15);
  assert.equal(pool.filter(q => q.scope === 'thai').length, 7);
  assert.equal(pool.filter(q => q.scope === 'world').length, 8);

  let seen = [];
  const d1 = selectEndless(bank, seen, () => 0.25, 1, 'football');
  seen = d1.seen;
  const d2 = selectEndless(bank, seen, () => 0.25, 2, 'football');
  assert.equal(d1.questions.length, 7);
  assert.equal(d2.questions.length, 7);
  assert.ok(d1.questions.every(q => q.football));
  assert.ok(d2.questions.every(q => q.football));
  const overlap = d2.questions.filter(q => d1.questions.some(x => x.id === q.id));
  assert.equal(overlap.length, 0, `Consecutive football dives repeated: ${overlap.map(q => q.id).join(', ')}`);
});

test('V1.1.1 anti-repeat FIFO rotation minimizes repeats across 15 classic endless dives and enforces Wordle cooldown', () => {
  let seen = [];
  const pickedIds = [];
  const wordleDiveIndices = [];
  for (let run = 1; run <= 15; run++) {
    const res = selectEndless(bank, seen, Math.random, run, 'classic');
    seen = res.seen;
    assert.equal(res.questions.length, 7);
    for (const q of res.questions) {
      pickedIds.push(q.id);
      if (q.id.startsWith('world-wordle-')) wordleDiveIndices.push(run);
    }
  }
  assert.ok(new Set(pickedIds).size >= 95, `Too many repeats across 15 dives: ${new Set(pickedIds).size}/105 unique`);
  for (let i = 1; i < wordleDiveIndices.length; i++) {
    assert.ok(
      wordleDiveIndices[i] - wordleDiveIndices[i - 1] >= 4,
      `Wordle cooldown violated: dives ${wordleDiveIndices[i - 1]} and ${wordleDiveIndices[i]}`
    );
  }
});

test('V1.1.1 expands & splits character pools, fixes Wordle 14k dictionary, playtest gaps, and Thai nicknames', () => {
  assert.ok(byId.get('world-one-piece-characters').answers.length >= 900);
  for (const [qid, probe] of [
    ['world-naruto-characters', 'อิทาจิ'],
    ['world-dragonball-characters', 'เบจิต้า'],
    ['world-conan-characters', 'ไฮบาระ ไอ'],
    ['world-doraemon-characters', 'ไจแอนท์'],
    ['world-starwars-characters', 'โยดา'],
    ['world-lotr-characters', 'Aragorn'],
    ['world-sanrio-characters', 'ชินนามอนโรล'],
    ['world-lol-champions', 'Ahri'],
    ['world-valorant-overwatch-heroes', 'Tracer'],
    ['world-wordle-words', 'PARER'],
    ['world-wordle-words', 'MYRRH'],
    ['world-wordle-starting-a-to-m', 'MYRRH'],
    ['world-famous-cities', 'Samarkand'],
    ['world-strategy-sim-indie-games', 'Kenshi'],
    ['world-athletes', 'Nadia Comaneci'],
    ['th-famous-people', 'โดม ปกรลัม'],
    ['th-famous-people', 'โดม ปกรณ์ ลัม'],
    ['th-thai-comedians-youtubers', 'อาไท'],
    ['th-thai-comedians-youtubers', 'โยกเยก'],
    ['world-football-managers', 'คล็อปป์'],
  ]) {
    const q = byId.get(qid);
    assert.ok(q, `Missing question ${qid}`);
    assert.equal(matchAnswer(q, probe)?.kind, 'exact', `Expected exact match for "${probe}" in ${qid}`);
  }
});

test('V1.1.1 normalizes orphan combining marks and matches Song - Artist segments on music questions', () => {
  assert.equal(normalize('์narita'), 'narita');
  const musicQ = byId.get('world-famous-artists');
  const m = matchAnswer(musicQ, 'Lose Yourself - Eminem');
  assert.equal(m?.kind, 'exact');
  assert.equal(m?.answer?.label, 'Eminem');
});

test('V1.1.1 storage persists per-group seenByGroup independently', () => {
  const prevStorage = globalThis.localStorage;
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: k => { store.delete(k); },
  };
  try {
    const save = emptySave();
    save.currentBankVersion = bank.version;
    save.seenByGroup.football = ['world-premier-league-clubs', 'th-thai-league-football-clubs'];
    writeSave(save);
    const loaded = prepareSaveForBank(readSave(), bank);
    assert.deepEqual(loaded.seenByGroup.football, ['world-premier-league-clubs', 'th-thai-league-football-clubs']);
  } finally {
    globalThis.localStorage = prevStorage;
  }
});

test('V1.1.1 all 12 buddy art sprites exist on disk', async () => {
  for (const file of [
    'krillion.png',
    'schooler.png',
    'rare.png',
    'deepcut.png',
    'plankton.png',
    'tooclever.png',
    'axolotl.png',
    'narwhal.png',
    'seadragon.png',
    'kraken.png',
  ]) {
    await access(new URL(`../assets/art/${file}`, import.meta.url));
  }
});
