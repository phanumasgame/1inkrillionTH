import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSession, selectDaily, settleRound, TIERS } from '../src/game.js';
import { emptySave, prepareSaveForBank, readSave, writeSave } from '../src/storage.js';
import { isSurveySession, prepareSurveyBank, surveyTier, validateSurveyBank } from '../src/survey.js';

const raw = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(raw);
const make = () => createSession({mode:'daily',bank,questions:selectDaily(bank,'2026-11-17'),date:'2026-11-17',now:1000});

test('active answers have survey metadata, published percentages and exact source examples', () => {
  assert.deepEqual(validateSurveyBank(raw), []);
  assert.equal(raw.questions.length, 12);
  assert.equal(raw.questions.filter(q=>q.scope==='thai').length, 9);
  assert.equal(raw.questions.filter(q=>q.scope==='world').length, 3);
  const food=raw.questions.find(q=>q.id==='survey-th-food-2020');
  assert.equal(food.survey.sampleSize, 1144);
  assert.deepEqual(food.answers.map(a=>a.percent), [57.31,51.09,42.61,39.37,38.32]);
  const fruit=raw.questions.find(q=>q.id==='survey-th-fruit-regular-2026');
  assert.equal(fruit.survey.sampleSize,5433);
  assert.equal(fruit.answers.find(a=>a.id==='papaya').percent,11.15);
  const media=raw.questions.find(q=>q.id==='survey-media-influence-th-2024');
  assert.equal(media.survey.sampleSize,5446);
  assert.deepEqual(media.answers.map(a=>a.percent), [40.89,40.89,39.81,39.02,25.69]);
  const us=raw.questions.find(q=>q.id==='survey-daily-us-2025');
  assert.equal(us.survey.sampleSize,6100);
  assert.equal(us.survey.sampleSizeQualifier,'ประมาณ ');
  assert.equal(us.answers.find(a=>a.id==='tv').percent,74.3);
  assert.ok(raw.questions.every(q=>q.answers.every(a=>!('count' in a) && !('tier' in a))));
});

test('game points are derived from published ordering, with equal percentages tied', () => {
  const q=structuredClone(raw.questions[0]);
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
