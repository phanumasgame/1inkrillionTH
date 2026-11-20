import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSession, matchAnswer, selectDaily, settleRound, TIERS } from '../src/game.js';
import { emptySave, prepareSaveForBank, readSave, writeSave } from '../src/storage.js';
import { BROAD_ANSWER_TARGET, HYBRID_SCORING, isSurveySession, MIN_PLAYABLE_ANSWERS, prepareSurveyBank, starterExample, SURVEY_TIERS, surveyTier, surveyValue, validateSurveyBank } from '../src/survey.js';

const raw = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(raw);
const make = () => createSession({mode:'daily',bank,questions:selectDaily(bank,'2026-11-17'),date:'2026-11-17',now:1000});

test('v1.0.6 hybrid bank has 100 everyday questions with clean provenance and broad animal coverage', () => {
  assert.deepEqual(validateSurveyBank(raw), []);
  assert.equal(raw.version, '1.0.6');
  assert.equal(raw.scoringMethod, HYBRID_SCORING);
  assert.equal(raw.questions.length, 100);
  assert.equal(raw.questions.filter(q => q.scope === 'thai').length, 50);
  assert.equal(raw.questions.filter(q => q.scope === 'world').length, 50);
  const surveyQuestions = raw.questions.filter(q => q.survey);
  const curatedQuestions = raw.questions.filter(q => q.curated);
  assert.equal(surveyQuestions.length, 18);
  assert.equal(curatedQuestions.length, 82);
  assert.equal(raw.questions.reduce((sum, q) => sum + q.answers.length, 0), 6540);
  assert.ok(raw.questions.every(q => q.answers.length >= MIN_PLAYABLE_ANSWERS));

  const fruit = raw.questions.find(q => q.id === 'th-acfs-fresh-fruit');
  assert.equal(fruit.survey.sampleSize, 7267);
  assert.equal(fruit.answers.find(a => a.id === 'acfs-191').percent, 67.9);
  const districts = raw.questions.find(q => q.id === 'th-nso-bangkok-districts-census-2010');
  assert.equal(districts.answers.length, 50);
  assert.equal(matchAnswer(districts, 'จตุจักร').answer.id, 'bkk-district-30');
  const tv = raw.questions.find(q => q.id === 'th-nbtc-digital-tv-channels-2025');
  assert.equal(tv.answers.length, 21);
  assert.equal(matchAnswer(tv, 'ช่อง 3').answer.id, 'ch3');
  const sports = raw.questions.find(q => q.id === 'th-ssa-sports-watched-2025');
  assert.equal(sports.survey.sampleSize, 6047);
  assert.equal(matchAnswer(sports, 'บอล').answer.percent, 64.92);
  const iceCream = raw.questions.find(q => q.id === 'world-ice-cream-flavors-idfa-2024');
  assert.equal(iceCream.answers.length, 40);
  assert.equal(iceCream.answers.find(a => a.id === 'vanilla').percent, 38);

  const animals = raw.questions.find(q => q.id === 'world-animals');
  assert.equal(animals.answers.length, 307);
  assert.equal(matchAnswer(animals, 'จิ้งจก').answer.id, 'animal-020');
  const homeCreatures = raw.questions.find(q => q.id === 'th-home-creatures');
  assert.equal(homeCreatures.answers.length, 47);
  assert.equal(matchAnswer(homeCreatures, 'จิ้งจก').answer.id, 'home-critter-001');

  assert.ok(surveyQuestions.every(q => !q.survey.url.includes('verasight')));
  assert.ok(surveyQuestions.every(q => q.answers.every(a => !('count' in a) && !('tier' in a))));
  assert.ok(curatedQuestions.every(q => q.answers.every(a => SURVEY_TIERS.includes(a.tier) && !('percent' in a) && !('rating' in a))));
});

test('overly specific prompts were retired and broader survey + curated questions score cleanly', () => {
  const find = id => raw.questions.find(q => q.id === id);
  for (const retired of [
    'th-roiet-edible-plants-2026',
    'world-acs-birthplaces-2024',
    'world-devographics-2025-movies',
    'world-devographics-2025-music',
    'world-butterflies',
    'world-banks-connell-fish',
    'world-banks-connell-bird',
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
  assert.equal(matchAnswer(khwam, 'ความรัก').answer.id, 'khwam-001');
  assert.equal(matchAnswer(pokemon, 'ปิกาจู').answer.id, 'pikachu');
  assert.equal(pokemon.answers.length, 805);
  assert.equal(find('th-province-trips').answers.length, 77);
  assert.equal(countries.answers.length, 196);
  assert.equal(find('world-us-states').answers.length, 50);
  assert.equal(find('world-board-games').answers.length, 44);
  assert.equal(find('world-card-games').answers.length, 34);
  assert.equal(starterExample(find('th-acfs-fresh-fruit')).id, 'acfs-205');
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
    const s=make();s.phase='answer';modify(s.questions[0]);
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
    q => { delete q.answers[0].reason; },
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
