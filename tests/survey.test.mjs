import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSession, matchAnswer, selectDaily, settleRound, TIERS } from '../src/game.js';
import { emptySave, prepareSaveForBank, readSave, writeSave } from '../src/storage.js';
import { isSurveySession, MIN_PLAYABLE_ANSWERS, prepareSurveyBank, surveyTier, validateSurveyBank } from '../src/survey.js';

const raw = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(raw);
const make = () => createSession({mode:'daily',bank,questions:selectDaily(bank,'2026-11-17'),date:'2026-11-17',now:1000});

test('active answers have survey metadata, published percentages and exact source examples', () => {
  assert.deepEqual(validateSurveyBank(raw), []);
  assert.ok(raw.questions.length>=40 && raw.questions.length<=50);
  assert.equal(raw.questions.filter(q=>q.scope==='thai').length,raw.questions.filter(q=>q.scope==='world').length);
  assert.ok(raw.questions.every(q=>q.answers.length >= MIN_PLAYABLE_ANSWERS));
  const food=raw.questions.find(q=>q.id==='th-one-dish-meals-dusit-2020');
  assert.equal(food.survey.sampleSize, 1566);
  assert.equal(food.answers.find(a=>a.id==='noodles').percent,80.19);
  const fruit=raw.questions.find(q=>q.id==='survey-th-fruit-regular-2026');
  assert.equal(fruit.survey.sampleSize,5433);
  assert.equal(fruit.answers.find(a=>a.id==='papaya').percent,11.15);
  const trip=raw.questions.find(q=>q.id==='th-tat-trip-activities-2023');
  assert.equal(trip.survey.sampleSize,null);
  assert.equal(trip.answers.length,18);
  assert.equal(matchAnswer(trip,'ถ่ายรูป').answer.percent,75.60);
  const asia=raw.questions.find(q=>q.id==='world-asia-destinations-siat-2025');
  assert.equal(asia.answers.length,14);
  assert.equal(matchAnswer(asia,'ประเทศไทย').answer.percent,1.3);
  assert.equal(raw.questions.find(q=>q.id==='world-board-games-2025').answers.length,22);
  assert.equal(raw.questions.find(q=>q.id==='world-card-games-2025').answers.length,25);
  const chat=raw.questions.find(q=>q.id==='survey-chat-apps-nbtc-2021');
  assert.equal(chat.survey.sampleSize,18496);
  assert.equal(chat.answers.find(a=>a.id==='line').percent,94.7);
  const iceCream=raw.questions.find(q=>q.id==='world-ice-cream-flavors-idfa-2024');
  assert.equal(iceCream.answers.length,40);
  assert.equal(iceCream.answers.find(a=>a.id==='vanilla').percent,38);
  const games=raw.questions.find(q=>q.id==='world-game-genres-pew-2008');
  assert.equal(games.survey.sampleSize,1064);
  assert.equal(games.answers.find(a=>a.id==='racing').percent,74);
  assert.equal(games.survey.translationNotice,'Pew Research Center has published the original content in English but has not reviewed or approved this translation.');
  assert.ok(raw.questions.every(q=>!q.survey.url.includes('verasight')));
  assert.ok(raw.questions.every(q=>q.answers.every(a=>!('count' in a) && !('tier' in a))));
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
