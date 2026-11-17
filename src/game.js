import { descentDuration } from './descent.js';

export const ANSWER_MS = 25_000;
export const PREVIEW_MS = 3_000;
export const TIME_ZONE = 'America/New_York';
export const TIERS = Object.freeze({
  plankton: { name: 'Plankton', score: 10, emoji: '🫧', color: '#88b0c5', blurb: 'The answer everyone blurts out.' },
  tooclever: { name: 'Too Clever', score: 15, emoji: '🤡', color: '#dc8fe5', blurb: 'The famously obscure pick.' },
  schooler: { name: 'Schooler', score: 30, emoji: '🐟', color: '#4cdbf1', blurb: 'Solid. Swims with the school.' },
  rare: { name: 'Rare', score: 60, emoji: '🦑', color: '#72e6b0', blurb: 'Genuinely uncommon. Nice pull.' },
  deepcut: { name: 'Deep Cut', score: 85, emoji: '🏮', color: '#c8a1f1', blurb: 'True obscurity. Few go this deep.' },
  krillion: { name: 'One in a Krillion', score: 100, emoji: '🌟', color: '#ffe387', blurb: 'The designated gem. Trench floor.' }
});
export const TIER_ORDER = Object.keys(TIERS);

export function dayKey(now = Date.now(), zone = TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
export function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function random(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
export function shuffle(values, rng = Math.random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
export function selectDaily(bank, date) {
  const rng = random(hash(bank.version + ':' + date));
  return diverseRound(bank.questions, rng);
}
const questionTheme = question => question.theme || question.category || question.id;

// Keep the 5:2 mix while giving each dive at least five themes and at most two
// questions per theme. For a 21-question deck, also reserve a feasible mix for
// the later rounds, so variety does not force early repeats in Endless.
export function diverseRound(questions, rng = Math.random, requiredIds = [], balanceRemaining = false) {
  const ordered = shuffle(questions, rng);
  if (balanceRemaining) {
    // Spend larger remaining themes steadily instead of leaving them all for
    // the last few dives. Shuffling still randomizes questions within a theme.
    const remainingByTheme = new Map();
    for (const q of ordered) remainingByTheme.set(questionTheme(q), (remainingByTheme.get(questionTheme(q)) || 0) + 1);
    ordered.sort((a,b) => remainingByTheme.get(questionTheme(b)) - remainingByTheme.get(questionTheme(a)));
  }
  const minimumThemes = Math.min(5,new Set(questions.map(questionTheme)).size);
  const required = new Set(requiredIds);
  const memo = new Set();
  function plan(pool, mandatory = new Set()) {
    const key = pool.map(q=>q.id).sort().join('|');
    if (!mandatory.size && memo.has(key)) return null;
    if (pool.filter(q=>q.scope==='thai').length < 5 || pool.filter(q=>q.scope==='world').length < 2) return null;
    const chosen = pool.filter(q=>mandatory.has(q.id));
    const candidates = pool.filter(q=>!mandatory.has(q.id));
    const counts = new Map();
    for (const q of chosen) counts.set(questionTheme(q),(counts.get(questionTheme(q))||0)+1);
    const thai = chosen.filter(q=>q.scope==='thai').length;
    const world = chosen.length-thai;
    if (thai>5 || world>2 || [...counts.values()].some(n=>n>2)) return null;
    function search(start, thaiCount, worldCount) {
      if (chosen.length===7) {
        if (thaiCount!==5 || worldCount!==2 || counts.size<minimumThemes) return null;
        const ids=new Set(chosen.map(q=>q.id)), remaining=pool.filter(q=>!ids.has(q.id));
        const remainingThai=remaining.filter(q=>q.scope==='thai').length;
        const remainingWorld=remaining.length-remainingThai;
        const fullFuture=pool.length<=28 && remaining.length>0 && remainingThai%5===0 &&
          remainingWorld%2===0 && remainingThai/5===remainingWorld/2;
        if (fullFuture) {
          const futureRounds=remainingThai/5, byTheme=new Map();
          for (const q of remaining) byTheme.set(questionTheme(q),(byTheme.get(questionTheme(q))||0)+1);
          if ([...byTheme.values()].some(n=>n>2*futureRounds) || !plan(remaining)) return null;
        }
        return [...chosen];
      }
      if (chosen.length+candidates.length-start<7) return null;
      for (let i=start;i<candidates.length;i++) {
        const q=candidates[i], theme=questionTheme(q), n=counts.get(theme)||0;
        if (n>=2 || q.scope==='thai' && thaiCount>=5 || q.scope==='world' && worldCount>=2) continue;
        chosen.push(q);counts.set(theme,n+1);
        const found=search(i+1,thaiCount+(q.scope==='thai'?1:0),worldCount+(q.scope==='world'?1:0));
        chosen.pop();if(n)counts.set(theme,n);else counts.delete(theme);
        if(found)return found;
      }
      return null;
    }
    const found=search(0,thai,world);
    if(!found && !mandatory.size)memo.add(key);
    return found;
  }
  const strict=plan(ordered,required);
  if(strict)return shuffle(strict,rng);
  // Small/custom banks can make the variety target impossible. Preserve scope,
  // unseen mandatory questions and playability, then maximize available variety.
  const picked=ordered.filter(q=>required.has(q.id)), counts=new Map();
  for(const q of picked)counts.set(questionTheme(q),(counts.get(questionTheme(q))||0)+1);
  for(const [scope,target] of [['thai',5],['world',2]]) {
    while(picked.filter(q=>q.scope===scope).length<target) {
      const candidates=ordered.filter(q=>q.scope===scope&&!picked.some(p=>p.id===q.id));
      candidates.sort((a,b)=>(counts.get(questionTheme(a))||0)-(counts.get(questionTheme(b))||0));
      if(!candidates.length)throw new Error('Not enough questions for a 5:2 dive.');
      const q=candidates[0];picked.push(q);counts.set(questionTheme(q),(counts.get(questionTheme(q))||0)+1);
    }
  }
  return shuffle(picked,rng);
}
export function selectEndless(bank, seen = [], rng = Math.random) {
  const available = [], required = [];
  const nextSeen = [...seen];
  for (const [scope, count] of [['thai', 5], ['world', 2]]) {
    const all = bank.questions.filter(q => q.scope === scope);
    let remaining = shuffle(all.filter(q => !seen.includes(q.id)), rng);
    if (remaining.length < count) {
      required.push(...remaining.map(q=>q.id));
      const used = new Set(remaining.map(q => q.id));
      remaining.push(...shuffle(all.filter(q => !used.has(q.id)), rng));
      for (const q of all) {
        let i;
        while ((i = nextSeen.indexOf(q.id)) >= 0) nextSeen.splice(i, 1);
      }
    }
    available.push(...remaining);
  }
  const picked = diverseRound(available,rng,required,true);
  nextSeen.push(...picked.map(q => q.id));
  return { questions: picked, seen: [...new Set(nextSeen)] };
}
export function normalize(text) {
  return String(text).normalize('NFC').trim().toLocaleLowerCase('th-TH')
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[“”"‘’]/g, '').replace(/\s+/g, ' ');
}
export function answerForms(text) {
  const value = normalize(text);
  return [...new Set([value, value.replace(/[.\s]/g, '')])];
}
function distance(a, b) {
  const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
  const left = [...segmenter.segment(a)].map(s => s.segment);
  const right = [...segmenter.segment(b)].map(s => s.segment);
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 0; i < left.length; i++) {
    const row = [i + 1];
    for (let j = 0; j < right.length; j++)
      row.push(Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + (left[i] === right[j] ? 0 : 1)));
    previous = row;
  }
  return previous[right.length];
}
export function matchAnswer(question, raw) {
  const value = normalize(raw);
  if (!value) return { kind: 'empty' };
  const forms = answerForms(value);
  const exact = question.answers.filter(a => [a.label, ...(a.aliases || [])].some(name => answerForms(name).some(f => forms.includes(f))));
  if (exact.length === 1) return { kind: 'exact', answer: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous' };
  if (value.length < 4) return { kind: 'unknown' };
  const candidates = question.answers.map(answer => ({
    answer, distance: Math.min(...[answer.label, ...(answer.aliases || [])].map(alias => {
      const normalized = normalize(alias);
      if (Math.abs(normalized.length - value.length) > 2) return Infinity;
      return distance(value, normalized);
    }))
  })).sort((a, b) => a.distance - b.distance);
  const limit = value.length >= 10 ? 2 : 1;
  if (candidates[0] && candidates[0].distance <= limit && candidates[0].distance < (candidates[1]?.distance ?? Infinity))
    return { kind: 'correction', answer: candidates[0].answer };
  return { kind: 'unknown' };
}
export function createSession({ mode, bank, questions, date = dayKey(), now = Date.now(), run = 1 }) {
  if (questions.length !== 7) throw new Error('A dive needs exactly seven questions.');
  return {
    schemaVersion: 1, id: mode + ':' + date + ':' + run + ':' + now, mode, date, run,
    bankVersion: bank.version, startedAt: now, phase: 'preview', index: 0,
    phaseUntil: now + PREVIEW_MS, deadline: now + PREVIEW_MS + ANSWER_MS,
    questions: structuredClone(questions), results: [], score: 0, depth: 0,
    correction: null, rejected: '', input: '', completedAt: null
  };
}
export function settleRound(session, answer, raw, reason, now = Date.now()) {
  if (!['answer', 'correction'].includes(session.phase)) return session;
  const tier = answer ? answer.tier : null;
  const points = tier ? TIERS[tier].score : 0;
  const result = { questionId: session.questions[session.index].id,
    prompt: session.questions[session.index].prompt, raw: String(raw).slice(0, 256),
    answerId: answer?.id ?? null, label: answer?.label ?? null, tier, points, reason,
    answeredAt: now, elapsedMs: Math.min(ANSWER_MS, Math.max(0, now - (session.deadline - ANSWER_MS))) };
  return {
    ...session, phase: 'sinking', phaseUntil: now + descentDuration(points),
    results: [...session.results, result], score: session.score + points,
    depth: session.depth + points * 10, correction: null, rejected: '', input: ''
  };
}
export function tickSession(session, now = Date.now()) {
  if (!session) return session;
  let next = session;
  if (next.phase === 'preview' && now >= next.phaseUntil) next = { ...next, phase: 'answer' };
  if (['answer', 'correction'].includes(next.phase) && now >= next.deadline)
    return settleRound(next, null, next.input || '', 'timeout', next.deadline);
  if (next.phase === 'sinking' && now >= next.phaseUntil)
    return { ...next, phase: 'reveal' };
  return next;
}
export function submitAnswer(session, raw, settings = {}, now = Date.now()) {
  const ready = tickSession(session, now);
  if (ready.phase !== 'answer') return ready;
  const entered = String(raw).slice(0, 256);
  const match = matchAnswer(ready.questions[ready.index], entered);
  if (match.kind === 'empty') return ready;
  if (match.kind === 'exact' || match.kind === 'correction' && settings.corrections === false)
    return settleRound(ready, match.answer, entered, 'correct', now);
  if (match.kind === 'correction')
    return { ...ready, phase: 'correction', correction: match.answer, input: entered, rejected: '' };
  return { ...ready, rejected: entered, input: settings.clearRejected ? '' : entered };
}
export function confirmCorrection(session, now = Date.now()) {
  const ready = tickSession(session, now);
  return ready.phase === 'correction' ? settleRound(ready, ready.correction, ready.input, 'corrected', now) : ready;
}
export function skipRound(session, now = Date.now()) {
  const ready = tickSession(session, now);
  return ['answer', 'correction'].includes(ready.phase) ? settleRound(ready, null, ready.input || '', 'skip', now) : ready;
}
export function nextRound(session, now = Date.now()) {
  if (session.phase !== 'reveal') return session;
  if (session.index === 6) return { ...session, phase: 'complete', completedAt: now, phaseUntil: null };
  return { ...session, index: session.index + 1, phase: 'preview', phaseUntil: now + PREVIEW_MS,
    deadline: now + PREVIEW_MS + ANSWER_MS, correction: null, rejected: '', input: '' };
}
export function shareText(session, includeLink = false, origin = '') {
  const marks = session.results.map(r => r.tier ? TIERS[r.tier].emoji : '⬛').join('');
  return 'Krillion TH · ' + (session.mode === 'daily' ? session.date : 'Endless #' + session.run) +
    '\n' + session.score + '/700 · ' + session.depth.toLocaleString('en-US') + 'm\n' + marks +
    (includeLink && origin ? '\n' + origin : '');
}
export function validateBank(bank) {
  const errors = [];
  if (!bank.version || !Array.isArray(bank.questions)) return ['Missing bank version or questions'];
  const ids = new Set();
  for (const q of bank.questions) {
    if (ids.has(q.id)) errors.push('Duplicate question: ' + q.id);
    ids.add(q.id);
    if (!q.prompt || !q.sources?.length) errors.push(q.id + ': missing prompt/sources');
    if (!['thai', 'world'].includes(q.scope)) errors.push(q.id + ': invalid scope');
    if (q.answers?.length < 5) errors.push(q.id + ': needs at least five answers');
    const seen = new Map();
    const answerIds = new Set();
    for (const a of q.answers || []) {
      if (!TIERS[a.tier]) errors.push(q.id + ': invalid tier ' + a.tier);
      if (!a.reason) errors.push(q.id + '/' + a.id + ': missing score rationale');
      if (answerIds.has(a.id)) errors.push(q.id + ': duplicate answer id ' + a.id);
      answerIds.add(a.id);
      for (const name of [a.label, ...(a.aliases || [])]) {
        for (const f of answerForms(name)) {
          if (seen.has(f) && seen.get(f) !== a.id) errors.push(q.id + ': ambiguous alias ' + name);
          seen.set(f, a.id);
        }
      }
    }
    if (q.answers?.filter(a => a.tier === 'krillion').length !== 1) errors.push(q.id + ': needs exactly one gem');
    if (new Set(q.answers?.map(a => a.tier)).size < 2) errors.push(q.id + ': needs multiple tiers');
  }
  if (bank.questions.filter(q => q.scope === 'thai').length < 5) errors.push('Not enough Thai questions');
  if (bank.questions.filter(q => q.scope === 'world').length < 2) errors.push('Not enough world questions');
  return errors;
}
