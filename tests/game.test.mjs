import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dayKey, TIME_ZONE, TIERS, PREVIEW_MS, ANSWER_MS, selectDaily, selectEndless, normalize, matchAnswer,
  createSession, tickSession, submitAnswer, confirmCorrection, skipRound, nextRound, shareText, validateBank } from '../src/game.js';
import { readSave, writeSave, emptySave, validSession, dailySlot, prepareSaveForBank,
  currentSavedSession, savedSessions } from '../src/storage.js';
import { prepareSurveyBank } from '../src/survey.js';

const catalog = JSON.parse(await readFile(new URL('../data/questions.json',import.meta.url),'utf8'));
const bank = prepareSurveyBank(JSON.parse(await readFile(new URL('../data/survey-bank.json',import.meta.url),'utf8')));
const date = '2026-11-17';
const now = 1794888000000;
const make = mode => createSession({mode:mode || 'daily',bank,questions:selectDaily(bank,date),date,now});
const answering = () => tickSession(make(),now+PREVIEW_MS);
const q = {id:'matching-fixture',prompt:'ชื่อจังหวัด',answers:[
  {id:'korat',label:'นครราชสีมา',aliases:['Korat','จังหวัดนครราชสีมา','Nakhon Ratchasima'],tier:'plankton'},
  {id:'chiang-mai',label:'เชียงใหม่',aliases:['Chiang Mai'],tier:'schooler'},
  {id:'chiang-rai',label:'เชียงราย',aliases:['Chiang Rai'],tier:'rare'},
  {id:'phuket',label:'ภูเก็ต',aliases:['Phuket'],tier:'deepcut'},
  {id:'trat',label:'ตราด',aliases:['Trat'],tier:'krillion'}
]};

test('the retained draft catalog has the promised coverage and unambiguous canonical names',()=>{
  assert.deepEqual(validateBank(catalog),[]);
  assert.equal(catalog.questions.length,100);
  assert.equal(catalog.questions.filter(q=>q.scope==='thai').length,70);
  assert.equal(catalog.questions.filter(q=>q.scope==='world').length,30);
  for(const question of catalog.questions) for(const answer of question.answers)
    assert.equal(matchAnswer(question,answer.label).answer.id,answer.id);
});
test('daily alternates the 4:3 split between consecutive days and is deterministic',()=>{
  const before=JSON.stringify(bank);
  assert.deepEqual(selectDaily(bank,date),selectDaily(bank,date));
  const first=selectDaily(bank,date),second=selectDaily(bank,'2026-11-18');
  for(const round of [first,second]) {
    assert.ok([3,4].includes(round.filter(q=>q.scope==='thai').length));
    assert.equal(new Set(round.map(q=>q.id)).size,7);
  }
  assert.equal([...first,...second].filter(q=>q.scope==='thai').length,7);
  assert.equal([...first,...second].filter(q=>q.scope==='world').length,7);
  assert.equal(JSON.stringify(bank),before);
  assert.notDeepEqual(first.map(q=>q.id),second.map(q=>q.id));
});
test('daily date uses New York calendar and handles daylight saving',()=>{
  assert.equal(TIME_ZONE,'America/New_York');
  assert.equal(dayKey(Date.parse('2026-11-17T04:59:59Z')),'2026-11-16');
  assert.equal(dayKey(Date.parse('2026-11-17T05:00:00Z')),'2026-11-17');
  assert.equal(dayKey(Date.parse('2026-07-17T03:59:59Z')),'2026-07-16');
  assert.equal(dayKey(Date.parse('2026-07-17T04:00:00Z')),'2026-07-17');
});
test('endless alternates evenly and exhausts unseen questions in each scope before repeating',()=>{
  let seen=[],pair=[];
  for(let i=0;i<20;i++){
    const before=seen,draw=selectEndless(bank,seen,()=>.42,i+1);
    seen=draw.seen;pair.push(...draw.questions);
    assert.equal(new Set(draw.questions.map(q=>q.id)).size,7);
    for(const scope of ['thai','world']) {
      const picked=draw.questions.filter(q=>q.scope===scope);
      const remaining=bank.questions.filter(q=>q.scope===scope&&!before.includes(q.id));
      if(remaining.length>=picked.length) assert.ok(picked.every(q=>!before.includes(q.id)));
      else assert.ok(remaining.every(q=>picked.some(item=>item.id===q.id)));
    }
    if(i%2===1) {
      assert.equal(pair.filter(q=>q.scope==='thai').length,7);
      assert.equal(pair.filter(q=>q.scope==='world').length,7);
      pair=[];
    }
  }
});
test('reviewed aliases and English capitalization match without destroying Thai marks',()=>{
  assert.equal(matchAnswer(q,'  KORAT  ').answer.label,'นครราชสีมา');
  assert.equal(matchAnswer(q,'จังหวัดนครราชสีมา').answer.label,'นครราชสีมา');
  assert.notEqual(normalize('ป่า'),normalize('ปา'));
  assert.equal(matchAnswer(q,'<img src=x onerror=alert(1)>').kind,'unknown');
  assert.equal(matchAnswer(q,' ').kind,'empty');
});
test('short ambiguous spellings never get guessed automatically',()=>{
  const question={answers:[{id:'a',label:'abcd',aliases:[]},{id:'b',label:'abce',aliases:[]}]};
  assert.equal(matchAnswer(question,'abcf').kind,'unknown');
  assert.equal(matchAnswer(question,'abc').kind,'unknown');
});
test('a unique near spelling offers a correction',()=>{
  assert.equal(matchAnswer(q,'Nakhon Ratchasimx').kind,'correction');
});
test('preview lasts 3 seconds and submission is disabled during it',()=>{
  const s=make();
  assert.equal(submitAnswer(s,s.questions[0].answers[0].label,{},now+100).phase,'preview');
  assert.equal(tickSession(s,now+PREVIEW_MS-1).phase,'preview');
  assert.equal(tickSession(s,now+PREVIEW_MS).phase,'answer');
  assert.equal(s.deadline,now+PREVIEW_MS+ANSWER_MS);
});
test('a correct answer scores once and cannot be double submitted',()=>{
  const s=answering(),a=s.questions[0].answers[0];
  const result=submitAnswer(s,a.label,{},now+PREVIEW_MS+20);
  assert.equal(result.results.length,1);
  assert.equal(result.score,TIERS[a.tier].score);
  assert.equal(result.depth,result.score*10);
  assert.equal(submitAnswer(result,a.label,{},now+PREVIEW_MS+25).results.length,1);
  assert.equal(s.results.length,0);
});
test('deadline wins over a simultaneous correct answer',()=>{
  const s=answering();
  const result=submitAnswer(s,s.questions[0].answers[0].label,{},s.deadline);
  assert.equal(result.results[0].reason,'timeout');
  assert.equal(result.score,0);
  assert.equal(result.results.length,1);
});
test('unknown entries preserve the deadline, support retries, and obey clear setting',()=>{
  const s=answering();
  const rejected=submitAnswer(s,'not a valid answer',{},now+4000);
  assert.equal(rejected.phase,'answer');assert.equal(rejected.results.length,0);
  assert.equal(rejected.deadline,s.deadline);assert.equal(rejected.input,'not a valid answer');
  assert.equal(submitAnswer(s,'not a valid answer',{clearRejected:true},now+4000).input,'');
  assert.equal(submitAnswer(rejected,s.questions[0].answers[0].label,{},now+4500).results.length,1);
});
test('correction must be confirmed before deadline and toggle can accept directly',()=>{
  const original=answering();
  const fixture={...original.questions[0],...q,answers:q.answers.map((a,i)=>({...a,percent:5-i}))};
  const s={...original,questions:[fixture,...original.questions.slice(1)]};
  const corrected=submitAnswer(s,'Nakhon Ratchasimx',{corrections:true},now+4000);
  assert.equal(corrected.phase,'correction');assert.equal(corrected.results.length,0);
  assert.equal(confirmCorrection(corrected,now+4100).results[0].label,'นครราชสีมา');
  assert.equal(confirmCorrection(corrected,s.deadline).results[0].reason,'timeout');
  assert.equal(submitAnswer(s,'Nakhon Ratchasimx',{corrections:false},now+4000).phase,'sinking');
});
test('restoring after a long hidden interval loses only the current timed prompt',()=>{
  const s=make();
  const restored=tickSession(JSON.parse(JSON.stringify(s)),s.deadline+100000);
  assert.equal(restored.results.length,1);assert.equal(restored.results[0].reason,'timeout');
  assert.equal(tickSession(restored,s.deadline+100001).phase,'reveal');
});
test('seven gem answers complete at 700 points and 7000m; completed results stay fixed',()=>{
  let s=make(),clock=now;
  for(let i=0;i<7;i++){
    clock=s.phaseUntil;s=tickSession(s,clock);
    const a=s.questions[i].answers.find(a=>a.tier==='krillion');
    s=submitAnswer(s,a.label,{},clock+20);
    clock=s.phaseUntil;s=tickSession(s,clock);
    assert.equal(s.phase,'reveal');
    s=nextRound(s,clock+10);
  }
  assert.equal(s.phase,'complete');assert.equal(s.score,700);assert.equal(s.depth,7000);
  assert.equal(s.results.length,7);assert.equal(nextRound(s,clock+100),s);
  const saved=JSON.stringify(s);const clone=structuredClone(bank);clone.questions[0].answers[0].percent=1;assert.equal(JSON.stringify(s),saved);
});
test('skip records zero and sharing never leaks answers or prompts',()=>{
  const s=skipRound(answering(),now+4000);
  assert.equal(s.results[0].reason,'skip');assert.equal(s.score,0);
  const text=shareText({...s,results:[{...s.results[0],label:'TOP SECRET',prompt:'HIDDEN PROMPT'}]},true,'http://localhost:4173');
  assert.ok(!text.includes('TOP SECRET'));assert.ok(!text.includes('HIDDEN PROMPT'));
  assert.ok(text.includes('http://localhost:4173'));
});
test('session snapshot remains usable if the current bank is updated',()=>{
  const s=make(),original=s.questions[0].prompt;
  const alternate=structuredClone(bank);alternate.questions.find(q=>q.id===s.questions[0].id).prompt='updated';
  assert.equal(s.questions[0].prompt,original);assert.ok(validSession(s));
  assert.ok(!validSession({...s,index:99}));assert.ok(!validSession({...s,deadline:null}));
});
test('storage handles corrupt JSON, unavailable storage and saved settings',()=>{
  const broken={getItem:()=>'{'};assert.deepEqual(readSave(broken),emptySave());
  const nullDaily={getItem:()=>JSON.stringify({version:1,daily:null,history:[]})};
  assert.deepEqual(readSave(nullDaily),emptySave());
  const denied={getItem:()=>{throw new Error('denied')},setItem:()=>{throw new Error('quota')}};
  assert.deepEqual(readSave(denied),emptySave());assert.equal(writeSave(emptySave(),denied),false);
  let text='';const store={getItem:()=>text,setItem:(key,value)=>{text=value}};
  const s=emptySave();s.settings.muted=true;assert.equal(writeSave(s,store),true);assert.equal(readSave(store).settings.muted,true);
});

test('bank migration retains old Daily snapshots and history while opening a fresh Daily',()=>{
  const old=make();old.bankVersion='older-bank';
  const saved=emptySave();saved.daily[date]=old;saved.seen=['retired-question',bank.questions[0].id];
  saved.settings.muted=true;saved.character='schooler';saved.resumeSessionId=old.id;
  const before=JSON.stringify(saved), migrated=prepareSaveForBank(saved,bank);
  assert.equal(JSON.stringify(saved),before);
  assert.deepEqual(migrated.daily[dailySlot(date,'older-bank')],old);
  assert.equal(migrated.daily[date],undefined);
  assert.equal(currentSavedSession(migrated,'daily',date,bank.version),null);
  assert.equal(currentSavedSession(migrated,'daily',date,'older-bank').id,old.id);
  assert.equal(savedSessions(migrated)[0].id,old.id);
  assert.equal(migrated.settings.muted,true);assert.equal(migrated.character,'schooler');
  assert.deepEqual(migrated.seen,[bank.questions[0].id]);assert.equal(migrated.resumeSessionId,null);
  const fresh=make();fresh.id+=':new';
  migrated.daily[dailySlot(date,bank.version)]=fresh;
  assert.equal(currentSavedSession(migrated,'daily',date,bank.version).id,fresh.id);
  assert.equal(savedSessions(migrated).length,2);
  const complete={...old,phase:'complete',results:Array.from({length:7},()=>({points:0}))};
  migrated.history=[complete];
  const twice=prepareSaveForBank(migrated,bank);
  assert.deepEqual(twice.history,[complete]);
  assert.deepEqual(twice.daily,migrated.daily);
});

test('Endless migration keeps each bank and the newest legacy snapshot',()=>{
  const old=make('endless');old.bankVersion='older-bank';
  const current=make('endless');current.id+=':new';
  const saved=emptySave();saved.endless=old;saved.endlessByBank={[bank.version]:current};
  const migrated=prepareSaveForBank(saved,bank);
  assert.equal(migrated.endless.id,current.id);
  assert.equal(currentSavedSession(migrated,'endless',date,'older-bank').id,old.id);
  assert.equal(savedSessions(migrated).length,2);
  migrated.endless={...current,id:'newest',startedAt:current.startedAt+1};
  const next=prepareSaveForBank(migrated,bank);
  assert.equal(next.endless.id,'newest');
  next.resumeSessionId=old.id;
  assert.equal(prepareSaveForBank(next,bank).resumeSessionId,old.id);
});

test('storage deduplicates broad answer snapshots and restores every old or new session exactly',()=>{
  const saved=prepareSaveForBank(emptySave(),bank),first=make();
  const complete={...first,phase:'complete',results:Array.from({length:7},()=>({points:10}))};
  saved.history=Array.from({length:40},(_,i)=>({...structuredClone(complete),id:'completed-'+i}));
  saved.daily[dailySlot(date,bank.version)]=first;
  saved.endless={...structuredClone(first),mode:'endless',id:'endless-1'};
  saved.endlessByBank[bank.version]=saved.endless;
  const changed=structuredClone(first);changed.id='older-content';changed.questions[0].prompt+=' (previous)';
  saved.daily[dailySlot(date,'older-bank')]=changed;
  let raw='';const store={getItem:()=>raw,setItem:(_,value)=>{raw=value}};
  assert.ok(writeSave(saved,store));
  const packed=JSON.parse(raw);
  assert.equal(packed.questionSnapshots.length,8);
  assert.ok(raw.length<JSON.stringify(saved).length/4);
  assert.deepEqual(readSave(store),saved);
  packed.history[0].questions[0]=999999;raw=JSON.stringify(packed);
  assert.equal(readSave(store).history.length,39);
});
