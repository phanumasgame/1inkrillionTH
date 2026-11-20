import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSession, matchAnswer, selectDaily, settleRound, TIERS } from '../src/game.js';
import { emptySave, prepareSaveForBank, readSave, writeSave } from '../src/storage.js';
import { BROAD_ANSWER_TARGET, curatedReason, HYBRID_SCORING, isSurveySession, MIN_PLAYABLE_ANSWERS, prepareSurveyBank, starterExample, SURVEY_TIERS, surveyTier, surveyValue, validateSurveyBank } from '../src/survey.js';

const raw = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(raw);
const make = () => createSession({mode:'daily',bank,questions:selectDaily(bank,'2026-11-17'),date:'2026-11-17',now:1000});

test('v1.0.9 rebalanced 120-question bank has 45k+ answers, 20 new categories, 12 1000+ pools, and calibrated rarities', () => {
  assert.deepEqual(validateSurveyBank(raw), []);
  assert.equal(raw.version, '1.0.9');
  assert.equal(raw.scoringMethod, HYBRID_SCORING);
  assert.equal(raw.questions.length, 120);
  assert.equal(raw.questions.filter(q => q.scope === 'thai').length, 60);
  assert.equal(raw.questions.filter(q => q.scope === 'world').length, 60);
  const surveyQuestions = raw.questions.filter(q => q.survey);
  const curatedQuestions = raw.questions.filter(q => q.curated);
  assert.equal(surveyQuestions.length, 6);
  assert.equal(curatedQuestions.length, 114);
  assert.ok(raw.questions.reduce((sum, q) => sum + q.answers.length, 0) >= 45_000);
  assert.ok(raw.questions.filter(q => q.answers.length >= BROAD_ANSWER_TARGET).length >= 110);
  assert.ok(raw.questions.filter(q => q.answers.length >= 1000).length >= 12);
  assert.ok(raw.questions.every(q => q.answers.length >= MIN_PLAYABLE_ANSWERS));

  // Tier calibration invariants: no curated pool hands out excessive 100-pt Krillions,
  // and well-known household/classic items stay in familiar tiers.
  for (const q of curatedQuestions) {
    const kCount = q.answers.filter(a => a.tier === 'krillion').length;
    assert.ok(kCount / q.answers.length <= 0.11, `${q.id} krillion ratio too high: ${kCount}/${q.answers.length}`);
  }
  const notKrillionChecks = [
    ['th-ssa-sports-played-2025', 'เทควันโด'],
    ['th-solo-singers', 'โบ สุนิตา'],
    ['th-islands', 'เกาะเกร็ด'],
    ['th-flowers', 'ปีบ'],
    ['th-childhood-cartoons', 'ปังปอนด์'],
    ['th-snack-brands', 'คารามูโจ้'],
    ['th-childhood-games', 'โพงพาง'],
    ['world-banks-connell-musical-instrument', 'กีตาร์โปร่ง'],
    ['world-ice-cream-flavors-idfa-2024', 'สตรอว์เบอร์รี'],
    ['world-cake', 'ทีรามิสุ'],
    ['world-game-consoles', 'Steam Deck'],
    ['world-banks-connell-tool', 'แว่นขยาย'],
    ['world-banks-connell-tool', 'ตลับเมตร'],
  ];
  for (const [qid, label] of notKrillionChecks) {
    const q = raw.questions.find(x => x.id === qid);
    const m = matchAnswer(q, label);
    assert.equal(m.kind, 'exact', `Expected ${label} in ${qid}`);
    assert.ok(['plankton', 'schooler'].includes(m.answer.tier), `${qid}:${label} was ${m.answer.tier}`);
  }

  // Spot-check the 20 new v1.0.9 Thai & World questions
  for (const [qid, probe] of [
    ['th-proverbs', 'ขี่ช้างจับตั๊กแตน'],
    ['th-ghosts-folklore', 'แม่นาคพระโขนง'],
    ['th-literary', 'พระอภัยมณี'],
    ['th-trees', 'ต้นมะม่วง'],
    ['th-breakfast', 'ปาท่องโก๋'],
    ['th-restaurant-chains', 'สุกี้ตี๋น้อย'],
    ['th-bkk-roads', 'สุขุมวิท'],
    ['th-rivers', 'เจ้าพระยา'],
    ['th-universities', 'จุฬา'],
    ['th-songs', 'แสงสุดท้าย'],
    ['world-landmarks', 'หอไอเฟล'],
    ['world-historical-figures', 'ไอน์สไตน์'],
    ['world-mythology', 'ซุส'],
    ['world-fashion-brands', 'Nike'],
    ['world-gems-minerals', 'ไพลิน'],
    ['world-stationery', 'ลิควิด'],
    ['world-weather-nature', 'แสงเหนือ'],
    ['world-body-parts', 'ไส้ติ่ง'],
    ['world-books', 'Harry Potter'],
    ['world-songs', 'Bohemian Rhapsody'],
  ]) {
    const q = raw.questions.find(x => x.id === qid);
    assert.ok(q && q.answers.length >= 100, `Missing or undersized new question: ${qid}`);
    assert.equal(matchAnswer(q, probe).kind, 'exact', `Missing probe ${probe} in ${qid}`);
  }

  const districts = raw.questions.find(q => q.id === 'th-nso-bangkok-districts-census-2010');
  assert.equal(districts.answers.length, 50);
  assert.equal(matchAnswer(districts, 'จตุจักร').answer.id, 'bkk-district-30');
  const tv = raw.questions.find(q => q.id === 'th-nbtc-digital-tv-channels-2025');
  assert.equal(tv.answers.length, 21);
  assert.equal(matchAnswer(tv, 'ช่อง 3').answer.id, 'ch3');

  const isaan = raw.questions.find(q => q.id === 'th-isaan-food');
  assert.ok(isaan.answers.length >= 250);
  for (const dish of ['ส้มตำไทย', 'ตำปูปลาร้า', 'ซอยจุ๊', 'เสือร้องไห้', 'อู๋เพี้ย', 'หมกฮวก', 'ผัดหมี่โคราช', 'แกงเปรอะ', 'ตับหวาน']) {
    assert.equal(matchAnswer(isaan, dish).kind, 'exact', 'Isan dish missing: ' + dish);
  }

  const anime = raw.questions.find(q => q.id === 'world-anime');
  assert.ok(anime.answers.length >= 2000);
  for (const title of ['วันพีซ', 'Attack on Titan', 'ผ่าพิภพไททัน', 'Frieren', 'Jujutsu Kaisen']) {
    assert.equal(matchAnswer(anime, title).kind, 'exact', 'Anime missing: ' + title);
  }
  assert.ok(raw.questions.find(q => q.id === 'world-famous-movies').answers.length >= 2000);
  assert.ok(raw.questions.find(q => q.id === 'world-famous-series').answers.length >= 2000);
  assert.ok(raw.questions.find(q => q.id === 'th-thai-films').answers.length >= 1000);
  assert.ok(raw.questions.find(q => q.id === 'th-thai-dramas').answers.length >= 1000);
  assert.ok(raw.questions.find(q => q.id === 'world-animation-films').answers.length >= 1000);

  const animals = raw.questions.find(q => q.id === 'world-animals');
  assert.ok(animals.answers.length >= 1000);
  assert.equal(matchAnswer(animals, 'จิ้งจก').kind, 'exact');
  const homeCreatures = raw.questions.find(q => q.id === 'th-home-creatures');
  assert.ok(homeCreatures.answers.length >= 100);
  assert.equal(matchAnswer(homeCreatures, 'จิ้งจก').kind, 'exact');

  assert.ok(surveyQuestions.every(q => !q.survey.url.includes('verasight')));
  assert.ok(surveyQuestions.every(q => q.answers.every(a => !('count' in a) && !('tier' in a))));
  assert.ok(curatedQuestions.every(q => q.answers.every(a => SURVEY_TIERS.includes(a.tier) && !('percent' in a) && !('rating' in a) && Boolean(curatedReason(q, a)))));
});

test('overly specific prompts were retired and broader survey + curated questions score cleanly', () => {
  const find = id => raw.questions.find(q => q.id === id);
  for (const retired of [
    'th-roiet-edible-plants-2026',
    'world-acs-birthplaces-2024',
    'world-devographics-2025-movies',
    'world-devographics-2025-music',
    'world-butterflies',
    'world-banks-connell-flower',
    'th-ssa-sports-watched-2025',
    'th-nhes-sweets-and-snacks',
    'th-etda-devices-2022',
    'world-home-tech-dcms-2025'
  ]) {
    assert.equal(find(retired), undefined, retired);
  }

  const snacks = find('th-acfs-named-snacks');
  const vegetables = find('th-acfs-market-vegetables');
  const home = find('th-tunorms-household-objects');
  const khwam = find('th-tunorms-khwam');
  const pokemon = find('world-favourite-pokemon-reddit-2019');
  const countries = find('world-countries');
  const elements = find('world-chemical-elements');
  for (const q of [snacks, vegetables, home, khwam, pokemon, countries, elements])
    assert.ok(q.answers.length >= BROAD_ANSWER_TARGET, q.id);
  assert.equal(matchAnswer(snacks, 'ขนมชั้น').answer.percent, 22.7);
  assert.equal(matchAnswer(snacks, 'ปอกกี้').answer.percent, 12.9);
  assert.equal(matchAnswer(vegetables, 'กะเพรา').answer.percent, 72.7);
  const remote = matchAnswer(home, 'รีโมท').answer;
  assert.equal(remote.label, 'รีโมต');
  assert.ok(surveyValue(home, remote) >= 1 && surveyValue(home, remote) <= 7);
  assert.equal(remote.percent, undefined);
  assert.equal(matchAnswer(khwam, 'ความรัก').kind, 'exact');
  assert.equal(matchAnswer(pokemon, 'ปิกาจู').answer.id, 'pikachu');
  assert.equal(pokemon.answers.length, 805);
  assert.equal(find('th-province-trips').answers.length, 77);
  assert.equal(countries.answers.length, 196);
  assert.equal(find('world-us-states').answers.length, 50);
  assert.ok(find('world-planets-space').answers.length >= 150);
  assert.ok(find('th-national-parks').answers.length >= 150);
  assert.equal(starterExample(snacks).percent >= 22.7, true);
  assert.equal(starterExample(find('world-animals')).tier, 'plankton');
  const broken = structuredClone(raw);
  const rating = broken.questions.find(q => q.id === home.id).answers[0];
  rating.percent = rating.rating;
  assert.ok(validateSurveyBank(broken).some(error => error.includes('invalid measured value')));
});

test('playable prompts use everyday language and accepted names resolve to their published group', () => {
  for (const question of raw.questions) {
    assert.doesNotMatch(question.prompt + ' ' + question.hint,/โพล|ผลสำรวจ|\b20\d\d\b|พ\.?ศ\.?\s*25\d\d/,question.id);
    for (const answer of question.answers) {
      for (const name of [answer.label,...answer.aliases]) {
        assert.equal(matchAnswer(question,name).answer?.id,answer.id,question.id+': '+name);
      }
    }
  }
});

test('game points are derived from published ordering, with equal percentages tied', () => {
  const q=structuredClone(raw.questions[0]);
  q.answers=q.answers.slice(0,5);
  q.answers.forEach((a,i)=>{a.percent=[80,40,40,10,5][i];a.tier='krillion';});
  const values=q.answers.map(a=>surveyTier(q,a.id));
  assert.deepEqual(values,['plankton','schooler','schooler','rare','krillion']);
  assert.equal(surveyTier(q,'not-reported'),null);
  const s=make();s.phase='answer';s.questions[0]=q;
  const result=settleRound(s,q.answers[0],q.answers[0].label,'correct',5000);
  assert.equal(result.results[0].tier,'plankton');
  assert.equal(result.score,TIERS.plankton.score);
});

test('missing provenance or percentage cannot receive a fabricated score or start a dive', () => {
  for (const modify of [
    q=>delete q.survey,
    q=>delete q.survey.sampleSize,
    q=>delete q.answers[0].percent,
    q=>q.answers[0].percent=0,
    q=>q.answers[0].percent=101,
    q=>q.survey.url='http://example.org',
    q=>q.answers[0].aliases.push(q.answers[1].label)
  ]) {
    const invalid=structuredClone(raw);modify(invalid.questions[0]);
    assert.ok(validateSurveyBank(invalid).length);
    assert.throws(()=>prepareSurveyBank(invalid));
    assert.throws(()=>createSession({mode:'daily',bank:invalid,questions:invalid.questions.slice(0,7),now:1000}));
    const s=make();s.phase='answer';s.questions[0]=structuredClone(raw.questions[0]);modify(s.questions[0]);
    assert.equal(isSurveySession(s),false);
    assert.equal(settleRound(s,s.questions[0].answers[0],'x','correct',5000),s);
    assert.equal(s.score,0);
  }
});

test('legacy editorial games remain stored but are not survey sessions', () => {
  const legacy=make();
  delete legacy.scoringMethod;
  legacy.bankVersion='editorial-old';
  legacy.phase='complete';
  legacy.results=Array.from({length:7},()=>({points:100,tier:'krillion'}));
  legacy.score=700;legacy.depth=7000;
  const saved=emptySave();saved.history=[legacy];saved.daily['old']=legacy;
  const migrated=prepareSaveForBank(saved,bank);
  let contents='';
  const storage={getItem:()=>contents,setItem:(_,value)=>{contents=value;}};
  assert.equal(writeSave(migrated,storage),true);
  const restored=readSave(storage);
  assert.deepEqual(restored.history[0],legacy);
  assert.equal(isSurveySession(restored.history[0]),false);
  legacy.phase='answer';
  assert.equal(settleRound(legacy,legacy.questions[0].answers[0],'x','correct',5000),legacy);
});

test('curated familiarity questions validate strictly and score + save through hybrid sessions', () => {
  const curatedIndex = raw.questions.findIndex(q => q.id === 'world-animals');
  assert.ok(curatedIndex >= 0);
  for (const modify of [
    q => { delete q.curated.basis; },
    q => { delete q.curated.coverage; },
    q => { delete q.answers[0].reason; delete q.curated.tierReasons; },
    q => { q.curated.tierReasons = { invalid: 'x' }; },
    q => { q.answers[0].percent = 50; },
    q => { q.answers.forEach(a => { if (a.tier === 'krillion') a.tier = 'rare'; }); },
    q => { q.survey = structuredClone(raw.questions[0].survey); }
  ]) {
    const invalid = structuredClone(raw);
    modify(invalid.questions[curatedIndex]);
    assert.ok(validateSurveyBank(invalid).length > 0);
    assert.throws(() => prepareSurveyBank(invalid));
  }

  const animals = structuredClone(raw.questions[curatedIndex]);
  const s = make();
  s.phase = 'answer';
  s.questions[0] = animals;
  const jingjok = matchAnswer(animals, 'จิ้งจก').answer;
  assert.equal(surveyTier(animals, jingjok.id), jingjok.tier);
  const result = settleRound(s, jingjok, 'จิ้งจก', 'correct', 5000);
  assert.equal(result.results[0].tier, jingjok.tier);
  assert.equal(result.score, TIERS[jingjok.tier].score);
  const saved = emptySave();
  saved.daily['2026-11-17@' + raw.version] = result;
  let contents = '';
  const storage = { getItem: () => contents, setItem: (_, value) => { contents = value; } };
  assert.equal(writeSave(saved, storage), true);
  const restored = readSave(storage);
  const restoredSession = restored.daily['2026-11-17@' + raw.version];
  assert.equal(isSurveySession(restoredSession), true);
  assert.equal(restoredSession.results[0].answerId, jingjok.id);
});
