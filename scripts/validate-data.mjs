import { readFile } from 'node:fs/promises';
import { validateBank, matchAnswer, TIERS } from '../src/game.js';
import { BROAD_ANSWER_TARGET, MIN_PLAYABLE_ANSWERS, validateSurveyBank } from '../src/survey.js';
const root = new URL('../', import.meta.url);
const bank = JSON.parse(await readFile(new URL('data/questions.json', root), 'utf8'));
const errors = validateBank(bank);
const active = JSON.parse(await readFile(new URL('data/survey-bank.json', root), 'utf8'));
errors.push(...validateSurveyBank(active));
if (active.questions.length < 40 || active.questions.length > 50) errors.push('Survey bank must have 40–50 playable questions');
if (active.questions.filter(q => q.scope === 'thai').length !== active.questions.filter(q => q.scope === 'world').length)
  errors.push('Playable questions must be split evenly between Thai and general topics');
for (const q of active.questions)
  if ((q.answers?.length ?? 0) < MIN_PLAYABLE_ANSWERS) errors.push(q.id + ': playable questions need at least ' + MIN_PLAYABLE_ANSWERS + ' measured answers');
for (const scope of ['thai','world'])
  if (active.questions.filter(q=>q.scope===scope && q.answers.length>=BROAD_ANSWER_TARGET).length<3)
    errors.push('Need three questions with ' + BROAD_ANSWER_TARGET + ' measured answers in scope ' + scope);
if (bank.questions.length !== 100) errors.push('Bank must have 100 questions');
if (bank.questions.filter(q => q.scope === 'thai').length !== 70) errors.push('Bank must have 70 Thai questions');
if (bank.questions.filter(q => q.scope === 'world').length !== 30) errors.push('Bank must have 30 world questions');
for (const q of bank.questions) {
  for (const s of q.sources) if (!/^https?:\/\//.test(s.url)) errors.push(q.id + ': invalid source URL');
  if (bank.contentStyle === 'thai-casual-v2') {
    if (!q.theme) errors.push(q.id + ': missing theme');
    if (q.answers.length < 25) errors.push(q.id + ': needs a broader casual answer set');
    if (new Set(q.starterAnswers).size < 5) errors.push(q.id + ': needs five distinct familiar starters');
    for (const starter of q.starterAnswers || []) {
      if (matchAnswer(q,starter).kind !== 'exact') errors.push(q.id + ': unrecognized starter ' + starter);
    }
  }
}
const audio = JSON.parse(await readFile(new URL('assets/audio-cues.json', root), 'utf8'));
for (const name of ['begin','descend','submit','submit_soft','reject','tierline','sink','land_small','land_big','krillion','miss','tick','surface','blub'])
  if (!audio.events[name]?.length) errors.push('Missing audio cue ' + name);
try {
  const evidence = JSON.parse(await readFile(new URL('data/evidence.json', root), 'utf8'));
  if (evidence.bankVersion !== bank.version) errors.push('Evidence bank version does not match');
  const expectedTitles = new Set(bank.questions.flatMap(q=>q.answers.map(a=>a.wikiTitle)).filter(Boolean));
  if (Object.keys(evidence.articles).length !== expectedTitles.size ||
    [...expectedTitles].some(title=>!evidence.articles[title])) errors.push('Evidence coverage does not match mapped article titles');
  for (const [title, article] of Object.entries(evidence.articles)) {
    if (article.status === 'ok') {
      if (article.months.length !== 12 || article.months.some(m => !Number.isFinite(m.views) || m.views < 0))
        errors.push('Invalid monthly evidence: ' + title);
      const total = article.months.reduce((sum,m)=>sum+m.views,0);
      if (total !== article.totalViews) errors.push('Wrong evidence total: ' + title);
    }
  }
} catch (error) {
  if (error.code === 'ENOENT') process.stdout.write('Legacy Wikipedia evidence snapshot is not present; it is not used for scoring.\n');
  else errors.push('Cannot validate evidence: ' + error.message);
}
if (errors.length) {
  for (const error of errors) process.stderr.write('FAIL: ' + error + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Validated ' + active.questions.length + ' survey questions and ' + bank.questions.length + ' retained draft questions, ' +
    bank.questions.reduce((sum,q)=>sum+q.answers.length,0) + ' draft answers, ' + Object.keys(TIERS).length + ' historical tier definitions and ' +
    Object.keys(audio.events).length + ' audio cues.\n');
}
