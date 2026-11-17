import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchAnswer, selectDaily, selectEndless, random } from '../src/game.js';

const bank=JSON.parse(await readFile(new URL('../data/questions.json',import.meta.url),'utf8'));

test('localized questions offer broad answer sets, familiar starters and working aliases',()=>{
  assert.equal(bank.contentStyle,'thai-casual-v2');
  assert.ok(new Set(bank.questions.map(q=>q.theme)).size>=9);
  for(const q of bank.questions) {
    assert.ok(q.answers.length>=25,q.id);
    assert.ok(new Set(q.starterAnswers).size>=5,q.id);
    for(const starter of q.starterAnswers) assert.equal(matchAnswer(q,starter).kind,'exact',q.id+': '+starter);
    for(const answer of q.answers) for(const name of [answer.label,...answer.aliases])
      assert.equal(matchAnswer(q,name).answer?.id,answer.id,q.id+': '+name);
  }
});

test('bounded sets match the stated Thai travel and original Kanto scopes',()=>{
  const get=id=>bank.questions.find(q=>q.id===id);
  assert.equal(get('th-province-trips').answers.length,77);
  assert.equal(get('th-bts-stations').answers.length,60);
  const pokemon=get('world-kanto-pokemon');
  assert.equal(pokemon.answers.length,151);
  assert.equal(matchAnswer(pokemon,'Pikachu').kind,'exact');
  assert.equal(matchAnswer(pokemon,'Nidoran').kind,'unknown');
  assert.notEqual(matchAnswer(pokemon,'Nidoran♂').answer?.id,matchAnswer(pokemon,'Nidoran♀').answer?.id);
  assert.equal(matchAnswer(get('th-bts-stations'),'สามย่าน').kind,'unknown');
});

test('new questions accept common Thai names and preserve the intended entity',()=>{
  const get=id=>bank.questions.find(q=>q.id===id);
  assert.equal(matchAnswer(get('th-mrt-blue'),'สถานีสวนจตุจักร').answer.label,'สวนจตุจักร');
  assert.equal(matchAnswer(get('th-mrt-blue'),'จตุจักร').answer.label,'สวนจตุจักร');
  assert.equal(matchAnswer(get('world-europe-trip'),'อังกฤษ').answer.label,'สหราชอาณาจักร');
  assert.equal(matchAnswer(get('world-asia-trip'),'ประเทศไทย').answer.label,'ไทย');
  assert.equal(matchAnswer(get('th-condiments'),'ซอสถั่วเหลือง').answer.label,'ซีอิ๊ว');
  assert.equal(matchAnswer(get('th-pets'),'ปลาการ์ฟ').answer.label,'ปลาคาร์ป');
  assert.equal(matchAnswer(get('th-solo-singers'),'เบิร์ด').answer.label,'เบิร์ด ธงไชย');
});

function assertVariety(questions) {
  const counts=new Map();
  for(const q of questions) counts.set(q.theme,(counts.get(q.theme)||0)+1);
  assert.ok(counts.size>=5,questions.map(q=>q.id).join(','));
  assert.ok([...counts.values()].every(n=>n<=2));
  assert.equal(questions.filter(q=>q.scope==='thai').length,5);
  assert.equal(questions.filter(q=>q.scope==='world').length,2);
}

test('Daily keeps broad topic variety across a year of dates',()=>{
  for(let i=0;i<366;i++) {
    const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
    assertVariety(selectDaily(bank,date));
  }
});

test('Endless keeps variety while exhausting both scopes of the expanded bank',()=>{
  for(let seed=1;seed<=20;seed++) {
    let seen=[];const all=[],rng=random(seed);
    for(let round=0;round<15;round++) {
      const draw=selectEndless(bank,seen,rng);seen=draw.seen;
      assertVariety(draw.questions);all.push(...draw.questions.map(q=>q.id));
      if(round===13) assert.equal(new Set(all).size,98,'seed '+seed);
    }
    assert.equal(new Set(all).size,100,'seed '+seed);
    assertVariety(selectEndless(bank,seen,rng).questions);
  }
});
