import { descentDuration } from './descent.js';
import { normalize, answerForms } from './answers.js';
import { BROAD_ANSWER_TARGET, HYBRID_SCORING, SURVEY_TIERS, isSurveySession, surveyTier, validateSurveyBank, validateSurveyQuestion } from './survey.js';
export { normalize, answerForms } from './answers.js';

export const ANSWER_MS = 25_000;
export const PREVIEW_MS = 3_000;
export const TIME_ZONE = 'America/New_York';
export const TIERS = Object.freeze({
  plankton: { name: 'Plankton', score: 10, emoji: '🫧', color: '#88b0c5', blurb: 'Near the top of the published survey results.' },
  tooclever: { name: 'Too Clever', score: 15, emoji: '🤡', color: '#dc8fe5', blurb: 'The famously obscure pick.' },
  schooler: { name: 'Schooler', score: 30, emoji: '🐟', color: '#4cdbf1', blurb: 'Ranked from the published survey choices.' },
  rare: { name: 'Rare', score: 60, emoji: '🦑', color: '#72e6b0', blurb: 'A lower-ranked published survey choice.' },
  deepcut: { name: 'Deep Cut', score: 85, emoji: '🏮', color: '#c8a1f1', blurb: 'Near the bottom of the published list.' },
  krillion: { name: 'One in a Krillion', score: 100, emoji: '🌟', color: '#ffe387', blurb: 'The lowest percentage in the published list.' }
});
export const TIER_ORDER = SURVEY_TIERS;

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
export function scopeTargetsForRound(round) {
  return Math.abs(round) % 2 === 1 ? { thai: 4, world: 3 } : { thai: 3, world: 4 };
}
export function selectDaily(bank, date) {
  const rng = random(hash(bank.version + ':' + date));
  const day = Math.floor(Date.parse(date + 'T00:00:00Z') / 86_400_000);
  if (!Number.isFinite(day)) throw new Error('Daily dive needs a calendar date.');
  return diverseRound(bank.questions, rng, [], false, scopeTargetsForRound(day));
}
const questionTheme = question => question.theme || question.category || question.id;
export function questionFamily(question) {
  const id = String(question?.id || '');
  if (/temple|sacred-and-heritage/.test(id)) return 'temples';
  if (/school|universit/.test(id)) return 'schools';
  if (/^th-words-|^th-dictionary-words$|^th-tunorms-(?:khwam|leading)/.test(id)) return 'thai-words';
  if (/wordle/.test(id)) return 'wordle';
  if (/cities|countries-and-major-cities|states-and-provinces|us-states/.test(id)) return 'cities-regions';
  if (/countries|asia-trip|europe-trip/.test(id)) return 'countries';
  if (/landmark/.test(id)) return 'landmarks';
  if (/islands|beaches|waterfalls|water-destinations|rivers/.test(id)) return 'water-places';
  if (/national-parks|parks-mountains/.test(id)) return 'parks-mountains';
  if (/bangkok-districts|bangkok-places|bkk-roads|rail-stations|urban-transit|provinces-districts|province-trips/.test(id)) return 'thai-places-transit';
  if (/anime|manga|childhood-cartoons|tv-shows-and-cartoons/.test(id)) return 'anime-cartoon';
  if (/movie|films|famous-series|kdrama|thai-dramas|screen-titles/.test(id)) return 'movies-series';
  if (/character|superhero|protagonist|heroes-villains/.test(id)) return 'characters';
  if (/actors|directors|hollywood-stars|famous-people|people-starting|royals-heroes|historical-icons|historical-figures|authors-scientists/.test(id)) return 'famous-people';
  if (/artists|bands|solo-singers/.test(id)) return 'music-artists';
  if (/songs|karaoke|pop-rock-hits|hiphop-rnb/.test(id)) return 'songs';
  if (/instrument/.test(id)) return 'instruments';
  if (/football-clubs/.test(id)) return 'football-clubs';
  if (/athletes|football-players|muaythai-stars/.test(id)) return 'athletes';
  if (/sports|move-body|childhood-games/.test(id)) return 'sports-activities';
  if (/video-games|action-rpg-games|strategy-sim|favourite-pokemon|game-consoles/.test(id)) return 'video-games';
  if (/board-games|card-games|board-and-card/.test(id)) return 'tabletop-games';
  if (/living-fish|freshwater-fish|sea-creatures|sharks-rays|shellfish|aquarium-and-reef|commercial-and-game-fish|aquatic-animals/.test(id)) return 'fish-marine';
  if (/world-animals|zoo-animals|dog-breeds|cat-breeds|dinosaurs|th-living-things|land-animals|home-creatures|pets|garden-insects|thai-birds|nature-invertebrates|nature-starting-prefix/.test(id)) return 'animals-fauna';
  if (/flowers|trees|kitchen-herbs|fruits-vegetables-herbs/.test(id)) return 'plants-flora';
  if (/dessert|cake|bakery|breads|ice-cream|named-snacks/.test(id)) return 'desserts-bakery';
  if (/companies|brands|shopping-malls|restaurant-chains|tech-apps/.test(id)) return 'brands-companies';
  if (/folklore|literary|festivals|proverbs/.test(id)) return 'thai-folklore-culture';
  return id;
}

function orderCandidates(questions, rng, balanceRemaining, cooldown) {
  const shuffled = shuffle(questions, rng);
  if (!balanceRemaining && !cooldown) return shuffled;
  const recentThemes = cooldown?.recentThemes || new Set();
  const recentFam1 = cooldown?.recentFamilies1 || new Set();
  const recentFam2 = cooldown?.recentFamilies2 || new Set();
  const famPenalty = q => {
    const f = questionFamily(q);
    return recentFam1.has(f) ? 2 : recentFam2.has(f) ? 1 : 0;
  };
  const byTheme = new Map();
  for (const q of shuffled) {
    const t = questionTheme(q);
    if (!byTheme.has(t)) byTheme.set(t, []);
    byTheme.get(t).push(q);
  }
  for (const [t, list] of byTheme) {
    const byFam = new Map();
    for (const q of list) {
      const f = questionFamily(q);
      if (!byFam.has(f)) byFam.set(f, []);
      byFam.get(f).push(q);
    }
    const famKeys = [...byFam.keys()].sort((a, b) => {
      const pa = recentFam1.has(a) ? 2 : recentFam2.has(a) ? 1 : 0;
      const pb = recentFam1.has(b) ? 2 : recentFam2.has(b) ? 1 : 0;
      return pa - pb;
    });
    const interleaved = [];
    let depth = 0, added = true;
    while (added) {
      added = false;
      for (const f of famKeys) {
        const arr = byFam.get(f);
        if (depth < arr.length) { interleaved.push(arr[depth]); added = true; }
      }
      depth++;
    }
    interleaved.sort((a, b) => famPenalty(a) - famPenalty(b));
    byTheme.set(t, interleaved);
  }
  const themes = [...byTheme.keys()];
  const ordered = [];
  let pass = 0, hasMore = true;
  while (hasMore) {
    hasMore = false;
    const passThemes = themes.filter(t => pass < byTheme.get(t).length);
    if (!passThemes.length) break;
    hasMore = true;
    const scored = passThemes.map(t => {
      const list = byTheme.get(t);
      const q = list[pass];
      const rem = list.length - pass;
      let weight = balanceRemaining ? Math.pow(rem, 0.72) : 1;
      if (pass === 0 && recentThemes.has(t)) weight *= 0.35;
      const fp = famPenalty(q);
      if (fp === 2) weight *= 0.2;
      else if (fp === 1) weight *= 0.48;
      const u = Math.max(1e-6, Math.min(1 - 1e-6, rng()));
      return { t, q, key: -Math.log(u) / weight };
    }).sort((a, b) => a.key - b.key);
    for (const item of scored) ordered.push(item.q);
    pass++;
  }
  return ordered;
}

// Seven prompts cannot be divided equally, so alternating dives use 4:3 and
// 3:4. Prefer seven distinct themes and sub-families per dive whenever possible.
export function diverseRound(questions, rng = Math.random, requiredIds = [], balanceRemaining = false, targets = scopeTargetsForRound(1), quota = null, cooldown = null) {
  const ordered = orderCandidates(questions, rng, balanceRemaining, cooldown);
  const broad = q => q.answers.length >= BROAD_ANSWER_TARGET;
  const availableThemeCount = new Set(questions.map(questionTheme)).size;
  const availableFamCount = new Set(questions.map(questionFamily)).size;
  const required = new Set(requiredIds);
  function plan(pool, mandatory = new Set(), broadMinimum = 0, broadPerScope = null, maxPerTheme = 1, maxPerFamily = 1) {
    if (pool.filter(q=>q.scope==='thai').length < targets.thai || pool.filter(q=>q.scope==='world').length < targets.world) return null;
    if (maxPerTheme === 1 && availableThemeCount < 7) return null;
    if (maxPerFamily === 1 && availableFamCount < 7) return null;
    const minimumThemes = maxPerTheme === 1 ? Math.min(7, availableThemeCount) : Math.min(5, availableThemeCount);
    const chosen = pool.filter(q=>mandatory.has(q.id));
    const candidates = pool.filter(q=>!mandatory.has(q.id));
    const remainingBroad = Array(candidates.length + 1).fill(0);
    for (let i = candidates.length - 1; i >= 0; i--) remainingBroad[i] = remainingBroad[i + 1] + Number(broad(candidates[i]));
    const counts = new Map(), famCounts = new Map();
    for (const q of chosen) {
      counts.set(questionTheme(q),(counts.get(questionTheme(q))||0)+1);
      famCounts.set(questionFamily(q),(famCounts.get(questionFamily(q))||0)+1);
    }
    const thai = chosen.filter(q=>q.scope==='thai').length;
    const world = chosen.length-thai;
    const broadThai = chosen.filter(q=>q.scope==='thai'&&broad(q)).length;
    const broadWorld = chosen.filter(q=>q.scope==='world'&&broad(q)).length;
    if (thai>targets.thai || world>targets.world || [...counts.values()].some(n=>n>maxPerTheme) || [...famCounts.values()].some(n=>n>maxPerFamily)) return null;
    let steps = 0;
    function search(start, thaiCount, worldCount, thaiWide, worldWide) {
      if (++steps > 2500) return null;
      const broadCount = thaiWide + worldWide;
      if (broadPerScope && (
        thaiWide > broadPerScope.thai || worldWide > broadPerScope.world ||
        thaiCount-thaiWide > targets.thai-broadPerScope.thai ||
        worldCount-worldWide > targets.world-broadPerScope.world
      )) return null;
      if (chosen.length===7) {
        if (thaiCount!==targets.thai || worldCount!==targets.world || counts.size<minimumThemes || broadCount<broadMinimum) return null;
        return [...chosen];
      }
      if (chosen.length+candidates.length-start<7) return null;
      if (broadCount + Math.min(7-chosen.length, remainingBroad[start]) < broadMinimum) return null;
      for (let i=start;i<candidates.length;i++) {
        const q=candidates[i], theme=questionTheme(q), fam=questionFamily(q), n=counts.get(theme)||0, fn=famCounts.get(fam)||0;
        if (n>=maxPerTheme || fn>=maxPerFamily || q.scope==='thai' && thaiCount>=targets.thai || q.scope==='world' && worldCount>=targets.world) continue;
        chosen.push(q);counts.set(theme,n+1);famCounts.set(fam,fn+1);
        const found=search(i+1,thaiCount+Number(q.scope==='thai'),worldCount+Number(q.scope==='world'),
          thaiWide+Number(q.scope==='thai'&&broad(q)),worldWide+Number(q.scope==='world'&&broad(q)));
        chosen.pop();
        if(n)counts.set(theme,n);else counts.delete(theme);
        if(fn)famCounts.set(fam,fn);else famCounts.delete(fam);
        if(found)return found;
      }
      return null;
    }
    return search(0,thai,world,broadThai,broadWorld);
  }
  const tryPlans = (bMin, bScope) =>
    plan(ordered, required, bMin, bScope, 1, 1) ||
    plan(ordered, required, bMin, bScope, 2, 1) ||
    plan(ordered, required, bMin, bScope, 2, 2);
  const strict = quota
    ? tryPlans(quota.thai+quota.world, quota)
    : tryPlans(Math.min(4,ordered.filter(broad).length), null) || tryPlans(0, null);
  if(strict)return shuffle(strict,rng);
  // Small/custom banks can make the variety target impossible. Preserve scope,
  // unseen mandatory questions and playability, then maximize available variety.
  const picked=ordered.filter(q=>required.has(q.id)), counts=new Map();
  for(const q of picked)counts.set(questionTheme(q),(counts.get(questionTheme(q))||0)+1);
  function fill(target, belongs) {
    while(picked.filter(belongs).length<target) {
      const candidates=ordered.filter(q=>belongs(q)&&!picked.some(p=>p.id===q.id));
      candidates.sort((a,b)=>(counts.get(questionTheme(a))||0)-(counts.get(questionTheme(b))||0));
      if(!candidates.length)throw new Error('Not enough questions for a balanced dive.');
      const q=candidates[0];picked.push(q);counts.set(questionTheme(q),(counts.get(questionTheme(q))||0)+1);
    }
  }
  for(const [scope,target] of Object.entries(targets)) {
    if (quota) {
      fill(quota[scope], q => q.scope===scope && broad(q));
      fill(target-quota[scope], q => q.scope===scope && !broad(q));
    } else fill(target, q => q.scope===scope);
  }
  return shuffle(picked,rng);
}
export function selectEndless(bank, seen = [], rng = Math.random, run = 1) {
  const available = [], required = [];
  const nextSeen = [...seen];
  const targets = scopeTargetsForRound(run);
  const byId = new Map(bank.questions.map(q => [q.id, q]));
  const last1 = seen.slice(-7).map(id => byId.get(id)).filter(Boolean);
  const last2 = seen.slice(-14, -7).map(id => byId.get(id)).filter(Boolean);
  const cooldown = {
    recentThemes: new Set(last1.map(questionTheme)),
    recentFamilies1: new Set(last1.map(questionFamily)),
    recentFamilies2: new Set(last2.map(questionFamily))
  };
  const quota = Object.keys(targets).every(scope => {
    const broadCount = bank.questions.filter(q=>q.scope===scope && q.answers.length>=BROAD_ANSWER_TARGET).length;
    const shortCount = bank.questions.filter(q=>q.scope===scope && q.answers.length<BROAD_ANSWER_TARGET).length;
    return broadCount >= 2 && shortCount >= Math.max(targets[scope] - 2, 15);
  }) ? { thai:2, world:2 } : null;
  // Cycle broad and smaller sets separately, so the broad set isn't exhausted
  // in the first few dives and every short set still gets a turn.
  for (const [scope, target] of Object.entries(targets)) {
    const questions = bank.questions.filter(q => q.scope === scope);
    const groups = quota ? [
      [questions.filter(q=>q.answers.length>=BROAD_ANSWER_TARGET),quota[scope]],
      [questions.filter(q=>q.answers.length<BROAD_ANSWER_TARGET),target-quota[scope]]
    ] : [[questions,target]];
    for (const [all,count] of groups) {
      let remaining = shuffle(all.filter(q => !seen.includes(q.id)), rng);
      if (remaining.length < count) {
        required.push(...remaining.map(q=>q.id));
        const used = new Set(remaining.map(q => q.id));
        const refill = all.filter(q => !used.has(q.id));
        refill.sort((a, b) => seen.lastIndexOf(a.id) - seen.lastIndexOf(b.id));
        const releaseCount = Math.max(count * 3, Math.ceil(refill.length * 0.55));
        const released = refill.slice(0, releaseCount);
        remaining.push(...shuffle(released, rng));
        const releasedIds = new Set(remaining.map(q => q.id));
        for (const q of all) {
          if (!releasedIds.has(q.id)) continue;
          let i;
          while ((i = nextSeen.indexOf(q.id)) >= 0) nextSeen.splice(i, 1);
        }
      }
      available.push(...remaining);
    }
  }
  const picked = diverseRound(available,rng,required,true,targets,quota,cooldown);
  for (const q of picked) {
    let i;
    while ((i = nextSeen.indexOf(q.id)) >= 0) nextSeen.splice(i, 1);
    nextSeen.push(q.id);
  }
  return { questions: picked, seen: nextSeen };
}
const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
const graphemes = text => /^[\x20-\x7e]*$/.test(text) ? text : Array.from(segmenter.segment(text), s => s.segment);

function stripThaiSilent(text) {
  if (!/[\u0E00-\u0E7F]/.test(text)) return '';
  return text
    .replace(/[\u0E01-\u0E2E][\u0E30-\u0E3A]?\u0E4C/g, '')
    .replace(/\u0E47/g, '')
    .replace(/[-.\s·()'!?:,/]/g, '');
}

function thaiSkeleton(text) {
  const base = stripThaiSilent(text);
  if (!base) return '';
  return base
    .replace(/[\u0E48-\u0E4E]/g, '')
    .replace(/กระ/g, 'กะ').replace(/รร/g, 'ัน').replace(/ัม/g, 'ำ').replace(/ใ/g, 'ไ')
    .replace(/[ฃฅฆคข]/g, 'ก').replace(/[ฌฉชซศษส]/g, 'ส').replace(/[ฎฏฐฑฒทธถต]/g, 'ด')
    .replace(/[ณญ]/g, 'น').replace(/[พฟภ]/g, 'บ').replace(/[รฬ]/g, 'ล');
}

function fuzzyVariants(name) {
  const out = new Set([name]);
  const clean = name.replace(/[-:.,!'’/()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length >= 4) out.add(clean);
  if (/^the\s+/.test(clean) && clean.length >= 8) {
    out.add(clean.slice(4).trim());
  }
  for (const v of [...out]) {
    if (v.length >= 6 && /[a-z]s$/.test(v) && !/(?:ss|us|is)$/.test(v)) {
      out.add(v.slice(0, -1));
    }
    const compact = v.replace(/\s+/g, '');
    if (compact.length >= 4) out.add(compact);
  }
  const thSilent = stripThaiSilent(name);
  if (thSilent.length >= 3) out.add(thSilent);
  return [...out];
}

const answerIndexes = new WeakMap();
function answerIndex(answers) {
  if (answerIndexes.has(answers)) return answerIndexes.get(answers);
  const exact = new Map(), fuzzyExact = new Map(), byLength = new Map();
  for (const answer of answers) {
    const names = new Set([answer.label, ...(answer.aliases || [])].map(normalize));
    const indexedVariants = new Set();
    for (const name of names) {
      for (const form of answerForms(name)) {
        if (!exact.has(form)) exact.set(form, new Set());
        exact.get(form).add(answer);
      }
      for (const v of fuzzyVariants(name)) {
        if (!fuzzyExact.has(v)) fuzzyExact.set(v, new Set());
        fuzzyExact.get(v).add(answer);
        if (v.length >= 4 && !indexedVariants.has(v)) {
          indexedVariants.add(v);
          if (!byLength.has(v.length)) byLength.set(v.length, []);
          byLength.get(v.length).push({ name: v, answer, parts: null });
        }
      }
      const skel = thaiSkeleton(name);
      if (skel.length >= 3) {
        if (!fuzzyExact.has(skel)) fuzzyExact.set(skel, new Set());
        fuzzyExact.get(skel).add(answer);
      }
    }
  }
  const index = { exact, fuzzyExact, byLength };
  answerIndexes.set(answers, index);
  return index;
}
function distance(left, right, maxDist = Infinity) {
  const n = left.length, m = right.length;
  if (Math.abs(n - m) > maxDist) return maxDist + 1;
  let previous = Array.from({ length: m + 1 }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    const row = [i + 1];
    let rowMin = row[0];
    const li = left[i];
    for (let j = 0; j < m; j++) {
      const val = Math.min(row[j] + 1, previous[j + 1] + 1, previous[j] + (li === right[j] ? 0 : 1));
      row.push(val);
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
    previous = row;
  }
  return previous[m];
}
export function matchAnswer(question, raw) {
  const value = normalize(raw);
  if (!value) return { kind: 'empty' };
  const index = answerIndex(question.answers);
  const exact = new Set(answerForms(value).flatMap(form => [...(index.exact.get(form) || [])]));
  if (exact.size === 1) return { kind: 'exact', answer: exact.values().next().value };
  if (exact.size > 1) return { kind: 'ambiguous' };
  if (value.length < 4) return { kind: 'unknown' };

  const fuzzyKeys = [...fuzzyVariants(value)];
  const skel = thaiSkeleton(value);
  if (skel.length >= 3) fuzzyKeys.push(skel);
  const fuzzyHits = new Set(fuzzyKeys.flatMap(k => [...(index.fuzzyExact.get(k) || [])]));
  if (fuzzyHits.size === 1) return { kind: 'correction', answer: fuzzyHits.values().next().value };

  const limit = value.length >= 14 ? 3 : value.length >= 7 ? 2 : 1;
  const queryForms = [value];
  const thSilent = stripThaiSilent(value);
  if (thSilent.length >= 4 && thSilent !== value) queryForms.push(thSilent);

  let best = new Set(), bestDistance = limit;
  for (const qVal of queryForms) {
    const parts = graphemes(qVal);
    for (let length = Math.max(4, qVal.length - limit); length <= qVal.length + limit; length++) {
      if (Math.abs(length - qVal.length) > bestDistance) continue;
      for (const entry of index.byLength.get(length) || []) {
        if (bestDistance === 1 && qVal[0] !== entry.name[0] && qVal.at(-1) !== entry.name.at(-1)) continue;
        entry.parts ??= graphemes(entry.name);
        if (Math.abs(parts.length - entry.parts.length) > bestDistance) continue;
        const delta = distance(parts, entry.parts, bestDistance);
        if (delta > bestDistance) continue;
        if (delta < bestDistance) { best = new Set(); bestDistance = delta; }
        best.add(entry.answer);
      }
    }
  }
  if (best.size === 1) return { kind: 'correction', answer: best.values().next().value };
  return { kind: 'unknown' };
}
export function createSession({ mode, bank, questions, date = dayKey(), now = Date.now(), run = 1 }) {
  if (questions.length !== 7) throw new Error('A dive needs exactly seven questions.');
  if (validateSurveyBank(bank).length || questions.some(q => validateSurveyQuestion(q).length || !bank.questions.some(item => item.id === q.id)))
    throw new Error('A dive requires survey-backed questions.');
  return {
    schemaVersion: 1, id: mode + ':' + date + ':' + run + ':' + now, mode, date, run,
    bankVersion: bank.version, scoringMethod: bank.scoringMethod || HYBRID_SCORING, startedAt: now, phase: 'preview', index: 0,
    phaseUntil: now + PREVIEW_MS, deadline: now + PREVIEW_MS + ANSWER_MS,
    questions: structuredClone(questions), results: [], score: 0, depth: 0,
    correction: null, rejected: '', rejectedInputs: [], input: '', completedAt: null
  };
}
export function settleRound(session, answer, raw, reason, now = Date.now()) {
  if (!isSurveySession(session) || !['answer', 'correction'].includes(session.phase)) return session;
  const question = session.questions[session.index];
  const recorded = answer ? question.answers.find(item => item.id === answer.id) : null;
  const tier = answer ? surveyTier(question, recorded?.id) : null;
  if (answer && !tier) return session;
  const points = tier ? TIERS[tier].score : 0;
  const rejectedInputs = Array.isArray(session.rejectedInputs) ? [...session.rejectedInputs] : [];
  const result = { questionId: question.id,
    prompt: question.prompt, raw: String(raw).slice(0, 256),
    answerId: recorded?.id ?? null, label: recorded?.label ?? null, tier, points, reason,
    answeredAt: now, elapsedMs: Math.min(ANSWER_MS, Math.max(0, now - (session.deadline - ANSWER_MS))),
    ...(rejectedInputs.length ? { rejectedInputs } : {}) };
  return {
    ...session, phase: 'sinking', phaseUntil: now + descentDuration(points),
    results: [...session.results, result], score: session.score + points,
    depth: session.depth + points * 10, correction: null, rejected: '', rejectedInputs: [], input: ''
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
  const trimmed = entered.trim().slice(0, 120);
  const norm = normalize(trimmed);
  const prevRejected = Array.isArray(ready.rejectedInputs) ? ready.rejectedInputs : [];
  const rejectedInputs = trimmed && norm && prevRejected.length < 12 && !prevRejected.some(item => normalize(item) === norm)
    ? [...prevRejected, trimmed] : prevRejected;
  return { ...ready, rejected: entered, rejectedInputs, input: settings.clearRejected ? '' : entered };
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
    deadline: now + PREVIEW_MS + ANSWER_MS, correction: null, rejected: '', rejectedInputs: [], input: '' };
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
