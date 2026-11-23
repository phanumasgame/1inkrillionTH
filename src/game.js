import { descentDuration } from './descent.js';
import { normalize, answerForms } from './answers.js';
import { BROAD_ANSWER_TARGET, HYBRID_SCORING, SURVEY_TIERS, isSurveySession, isTrustedPreparedQuestion, surveyTier, validateSurveyBank, validateSurveyQuestion } from './survey.js';
export { normalize, answerForms } from './answers.js';

export const ANSWER_MS = 30_000;
export const PREVIEW_MS = 3_000;
export const TIME_ZONE = 'America/New_York';
export const DIVE_GROUPS = Object.freeze([
  Object.freeze({
    id: 'classic',
    route: '/unlimited/classic',
    title: 'ENDLESS CLASSIC',
    shortTitle: 'CLASSIC',
    tag: 'DIVE AFTER DIVE',
    emoji: '∞',
    subtitle: 'ครบทุกหมวด 14 แนว ผสมโจทย์ไทย–ทั่วไปสมดุลทุกรอบ',
    oceanTitle: 'OPEN KRILLION OCEAN',
    themes: null,
  }),
  Object.freeze({
    id: 'entertainment',
    route: '/unlimited/entertainment',
    title: 'KRILLION ENTERTAIN',
    shortTitle: 'ENTERTAIN',
    tag: 'SCREEN · MUSIC · GAMES',
    emoji: '🎬',
    subtitle: 'หนัง ซีรีส์ อนิเมะ ตัวละคร เพลง ศิลปิน และเกมฮิต',
    oceanTitle: 'NEON REEF STAGE',
    themes: ['screen', 'music', 'games'],
  }),
  Object.freeze({
    id: 'geography',
    route: '/unlimited/geography',
    title: 'KRILLION GEOGRAPHY',
    shortTitle: 'GEOGRAPHY',
    tag: 'WORLD · TRAVEL · CULTURE',
    emoji: '🧭',
    subtitle: 'ประเทศ เมือง แลนด์มาร์ก วัด สถานที่เที่ยว และวัฒนธรรม',
    oceanTitle: 'SUNKEN ATLAS TRENCH',
    themes: ['travel', 'culture'],
  }),
  Object.freeze({
    id: 'nature',
    route: '/unlimited/nature',
    title: 'KRILLION NATURE & SCI',
    shortTitle: 'NATURE & SCI',
    tag: 'LIFE · SCIENCE · SPORT',
    emoji: '🐋',
    subtitle: 'สัตว์โลก สัตว์ทะเล พืชพรรณ ดาราศาสตร์ วิทยาศาสตร์ และกีฬา',
    oceanTitle: 'KELP & ABYSS SANCTUARY',
    themes: ['nature', 'science', 'sport'],
  }),
  Object.freeze({
    id: 'lifestyle',
    route: '/unlimited/lifestyle',
    title: 'KRILLION FOOD & DAILY',
    shortTitle: 'FOOD & DAILY',
    tag: 'FOOD · BRANDS · WORDPLAY',
    emoji: '🍜',
    subtitle: 'อาหารไทย–โลก ขนม แบรนด์ดัง ของใช้รอบตัว และเล่นคำ',
    oceanTitle: 'AMBER HARBOR LAGOON',
    themes: ['food', 'dessert', 'ingredients', 'brands', 'everyday', 'wordplay'],
  }),
  Object.freeze({
    id: 'football',
    route: '/unlimited/football',
    title: 'KRILLION FOOTBALL',
    shortTitle: 'FOOTBALL',
    tag: 'PREMIER LEAGUE · THAI LEAGUE · WORLD CUP',
    emoji: '⚽',
    subtitle: 'พรีเมียร์ลีก ไทยลีก ช้างศึก นักเตะ โค้ช สนาม และฟุตบอลโลก',
    oceanTitle: 'FLOODLIT PITCH ARENA',
    themes: ['sport'],
    filter: q => Boolean(q.football) || /foot|soccer|premier-league|world-cup|thai-league|muaythai-stars/i.test(q.id),
  }),
]);
const GROUP_BY_ID = new Map(DIVE_GROUPS.map(g => [g.id, g]));
export function getDiveGroup(groupId = 'classic') {
  return GROUP_BY_ID.get(groupId) || GROUP_BY_ID.get('classic');
}
export function filterQuestionsByGroup(questions, groupId = 'classic') {
  const group = getDiveGroup(groupId);
  if (typeof group.filter === 'function') {
    const filtered = questions.filter(group.filter);
    return filtered.length >= 14 ? filtered : questions;
  }
  if (!group.themes) return questions;
  const allowed = new Set(group.themes);
  const filtered = questions.filter(q => allowed.has(q.theme));
  return filtered.length >= 14 ? filtered : questions;
}
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
  if (/harry-potter|one-piece|marvel-mcu|disney-pixar|naruto-characters|dragonball-characters|conan-characters|doraemon-characters|starwars-characters|lotr-characters|sanrio-characters|minecraft-items|lol-champions|valorant-overwatch|ramakien|phra-aphai|rov-heroes|online-mobile-games|gdh-gth|famous-dramas|bnk-tpops|comedians-youtubers|markets-nightmarkets|thai-horror-movies|thai-sitcoms-variety|retro-pc-console|traditional-sweets|proverbs-slang-idioms|cafe-bubbletea|english-common-abbrev|english-loanwords|premier-league-clubs|football-managers|football-stadiums|world-cup-national-teams|football-terms-leagues|thai-national-footballers|thai-football-stadiums|thai-football-managers|thai-football-competitions|thai-league-foreign/.test(id)) return id;
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
  const seenRank = cooldown?.seenRank || null;
  const wordleCooldown = Boolean(cooldown?.recentWordle);
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
      const pa = (recentFam1.has(a) ? 2 : recentFam2.has(a) ? 1 : 0) + (wordleCooldown && a === 'wordle' ? 2 : 0);
      const pb = (recentFam1.has(b) ? 2 : recentFam2.has(b) ? 1 : 0) + (wordleCooldown && b === 'wordle' ? 2 : 0);
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
    interleaved.sort((a, b) => {
      const sa = seenRank && seenRank.has(a.id) ? 1 : 0;
      const sb = seenRank && seenRank.has(b.id) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      if (sa === 1 && sb === 1) return Math.floor(seenRank.get(a.id) / 7) - Math.floor(seenRank.get(b.id) / 7);
      const wa = wordleCooldown && questionFamily(a) === 'wordle' ? 1 : 0;
      const wb = wordleCooldown && questionFamily(b) === 'wordle' ? 1 : 0;
      return (famPenalty(a) + wa) - (famPenalty(b) + wb);
    });
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
      if (seenRank && seenRank.has(q.id)) weight *= 0.02;
      if (wordleCooldown && questionFamily(q) === 'wordle') weight *= 0.15;
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
    const minimumThemes = maxPerTheme === 1
      ? Math.min(7, availableThemeCount)
      : Math.min(availableThemeCount, Math.min(5, Math.ceil(7 / maxPerTheme)));
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
  const groupThemeCap = availableThemeCount >= 7 ? 1 : Math.min(7, Math.ceil(7 / Math.max(1, availableThemeCount)) + 1);
  const tryPlans = (bMin, bScope) =>
    plan(ordered, required, bMin, bScope, 1, 1) ||
    plan(ordered, required, bMin, bScope, Math.max(2, groupThemeCap), 1) ||
    plan(ordered, required, bMin, bScope, Math.max(2, groupThemeCap), 2);
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
export function selectEndless(bank, seen = [], rng = Math.random, run = 1, groupId = 'classic') {
  const poolQuestions = filterQuestionsByGroup(bank.questions, groupId);
  const available = [], required = [];
  const nextSeen = [...seen];
  const seenRank = new Map();
  for (let idx = 0; idx < seen.length; idx++) seenRank.set(seen[idx], idx);
  const targets = scopeTargetsForRound(run);
  const byId = new Map(poolQuestions.map(q => [q.id, q]));
  const last1 = seen.slice(-7).map(id => byId.get(id)).filter(Boolean);
  const last2 = seen.slice(-14, -7).map(id => byId.get(id)).filter(Boolean);
  const last3 = seen.slice(-21).map(id => byId.get(id)).filter(Boolean);
  const cooldown = {
    recentThemes: new Set(last1.map(questionTheme)),
    recentFamilies1: new Set(last1.map(questionFamily)),
    recentFamilies2: new Set(last2.map(questionFamily)),
    recentWordle: last3.some(q => questionFamily(q) === 'wordle'),
    seenRank,
  };
  const quota = Object.keys(targets).every(scope => {
    const broadCount = poolQuestions.filter(q => q.scope === scope && q.answers.length >= BROAD_ANSWER_TARGET).length;
    const shortCount = poolQuestions.filter(q => q.scope === scope && q.answers.length < BROAD_ANSWER_TARGET).length;
    return broadCount >= 2 && shortCount >= Math.max(targets[scope] - 2, 15);
  }) ? { thai: 2, world: 2 } : null;

  for (const [scope, target] of Object.entries(targets)) {
    const questions = poolQuestions.filter(q => q.scope === scope);
    const groups = quota ? [
      [questions.filter(q => q.answers.length >= BROAD_ANSWER_TARGET), quota[scope]],
      [questions.filter(q => q.answers.length < BROAD_ANSWER_TARGET), target - quota[scope]]
    ] : [[questions, target]];
    for (const [all, count] of groups) {
      let remaining = shuffle(all.filter(q => !seenRank.has(q.id)), rng);
      if (remaining.length < count) {
        required.push(...remaining.map(q => q.id));
        const used = new Set(remaining.map(q => q.id));
        const refill = all.filter(q => !used.has(q.id));
        refill.sort((a, b) => (seenRank.get(a.id) ?? -1) - (seenRank.get(b.id) ?? -1));
        const releaseCount = Math.min(refill.length, Math.max(count - remaining.length + 4, Math.ceil(refill.length * 0.25)));
        remaining.push(...refill.slice(0, releaseCount));
      }
      available.push(...remaining);
    }
  }
  const picked = diverseRound(available, rng, required, true, targets, quota, cooldown);
  for (const q of picked) {
    let i;
    while ((i = nextSeen.indexOf(q.id)) >= 0) nextSeen.splice(i, 1);
    nextSeen.push(q.id);
  }
  return { questions: picked, seen: nextSeen };
}
const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
const graphemes = text => /^[\x20-\x7e]*$/.test(text) ? text : Array.from(segmenter.segment(text), s => s.segment);

function punctCompact(text) {
  return String(text || '').replace(/&/g, 'and').replace(/[-.\s·()'’!?:,/]/g, '');
}

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

function thaiLooseSkeleton(text) {
  const s = thaiSkeleton(text);
  if (!s) return '';
  return s
    .replace(/\u0E35/g, '\u0E34')
    .replace(/\u0E39/g, '\u0E38')
    .replace(/\u0E37/g, '\u0E36')
    .replace(/\u0E41/g, '\u0E40')
    .replace(/([\u0E01-\u0E2E])\1+/g, '$1');
}

function enConsonantSkeleton(text) {
  if (!/[a-z]/.test(text) || /[\u0E00-\u0E7F]/.test(text)) return '';
  return text
    .replace(/[-.\s·()'’!?:,/]/g, '')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/[aeiou]/g, '');
}

function charMask(text) {
  let mask = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
    else if (code >= 48 && code <= 57) mask |= 1 << 26;
    else if (code >= 0x0E01 && code <= 0x0E5B) mask |= 1 << (27 + (code % 5));
  }
  return mask >>> 0;
}

function popcountDiff(a, b) {
  let x = (a ^ b) >>> 0, c = 0;
  while (x) { x &= x - 1; c++; }
  return c;
}

function fuzzyVariants(name) {
  const out = new Set([name]);
  const clean = name.replace(/&/g, ' and ').replace(/[-:.,!'’·/()]/g, ' ').replace(/\s+/g, ' ').trim();
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
  for (const prefix of ['ดาว', 'แม่น้ำ', 'ขนมปัง', 'สโมสรฟุตบอล', 'รูปปั้น']) {
    if (name.startsWith(prefix) && name.length >= prefix.length + 3) {
      out.add(name.slice(prefix.length).trim());
    }
  }
  return [...out];
}

function addMapEntry(map, key, val) {
  const prev = map.get(key);
  if (prev === undefined) map.set(key, val);
  else if (Array.isArray(prev)) { if (!prev.includes(val)) prev.push(val); }
  else if (prev !== val) map.set(key, [prev, val]);
}

function collectMapHits(map, keys) {
  let single = null;
  let multi = null;
  for (const key of keys) {
    const hit = map.get(key);
    if (!hit) continue;
    if (Array.isArray(hit)) {
      multi ??= new Set(single ? [single] : []);
      for (const a of hit) multi.add(a);
    } else {
      if (multi) multi.add(hit);
      else if (single === null) single = hit;
      else if (single !== hit) multi = new Set([single, hit]);
    }
  }
  if (multi) return multi;
  return single ? new Set([single]) : new Set();
}

const answerIndexes = new WeakMap();
export function prewarmQuestionIndex(question) {
  if (question?.answers) answerIndex(question.answers);
}
function answerIndex(answers) {
  if (answerIndexes.has(answers)) return answerIndexes.get(answers);
  const exact = new Map(), punctExact = new Map();
  for (const answer of answers) {
    const names = [answer.label, ...(answer.aliases || [])];
    for (let i = 0; i < names.length; i++) {
      const name = normalize(names[i]);
      const forms = answerForms(name);
      for (let j = 0; j < forms.length; j++) addMapEntry(exact, forms[j], answer);
      const pc = punctCompact(name);
      if (pc.length >= 2) addMapEntry(punctExact, pc, answer);
    }
  }
  let fuzzy = null;
  const getFuzzy = () => {
    if (fuzzy) return fuzzy;
    const fuzzyExact = new Map(), byLength = new Map(), thaiByLength = new Map();
    for (const answer of answers) {
      const names = new Set([answer.label, ...(answer.aliases || [])].map(normalize));
      const indexedVariants = new Set(), indexedThai = new Set();
      for (const name of names) {
        for (const v of fuzzyVariants(name)) {
          addMapEntry(fuzzyExact, v, answer);
          if (v.length >= 4 && !indexedVariants.has(v)) {
            indexedVariants.add(v);
            if (!byLength.has(v.length)) byLength.set(v.length, []);
            byLength.get(v.length).push({ name: v, answer, parts: null, mask: charMask(v) });
          }
        }
        const skel = thaiSkeleton(name);
        if (skel.length >= 3) {
          addMapEntry(fuzzyExact, skel, answer);
          const loose = thaiLooseSkeleton(name);
          if (loose.length >= 3) addMapEntry(fuzzyExact, loose, answer);
          if (loose.length >= 4 && !indexedThai.has(loose)) {
            indexedThai.add(loose);
            if (!thaiByLength.has(loose.length)) thaiByLength.set(loose.length, []);
            thaiByLength.get(loose.length).push({ name: loose, answer, parts: null, mask: charMask(loose) });
          }
        }
      }
    }
    fuzzy = { fuzzyExact, byLength, thaiByLength };
    return fuzzy;
  };
  const index = { exact, punctExact, getFuzzy };
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
function matchCore(index, value) {
  const exact = collectMapHits(index.exact, answerForms(value));
  if (exact.size === 1) return { kind: 'exact', answer: exact.values().next().value };
  if (exact.size > 1) return { kind: 'ambiguous' };
  const pcVal = punctCompact(value);
  if (pcVal.length >= 2) {
    const pHit = collectMapHits(index.punctExact, [pcVal]);
    if (pHit.size === 1) return { kind: 'exact', answer: pHit.values().next().value };
  }
  if (value.length < 4) return { kind: 'unknown' };

  const { fuzzyExact, byLength, thaiByLength } = index.getFuzzy();
  const fuzzyKeys = [...fuzzyVariants(value)];
  const skel = thaiSkeleton(value);
  const looseSkel = thaiLooseSkeleton(value);
  if (skel.length >= 3) fuzzyKeys.push(skel);
  if (looseSkel.length >= 3 && looseSkel !== skel) fuzzyKeys.push(looseSkel);
  const fuzzyHits = collectMapHits(fuzzyExact, fuzzyKeys);
  if (fuzzyHits.size === 1) return { kind: 'correction', answer: fuzzyHits.values().next().value };

  const limit = value.length >= 14 ? 3 : value.length >= 7 ? 2 : 1;
  const queryForms = [value];
  const thSilent = stripThaiSilent(value);
  if (thSilent.length >= 4 && thSilent !== value) queryForms.push(thSilent);

  let best = new Set(), bestDistance = limit;
  for (const qVal of queryForms) {
    const parts = graphemes(qVal);
    const qMask = charMask(qVal);
    for (let length = Math.max(4, qVal.length - limit); length <= qVal.length + limit; length++) {
      if (Math.abs(length - qVal.length) > bestDistance) continue;
      for (const entry of byLength.get(length) || []) {
        if (bestDistance === 1 && qVal[0] !== entry.name[0] && qVal.at(-1) !== entry.name.at(-1)) continue;
        if (popcountDiff(qMask, entry.mask) > bestDistance * 2) continue;
        entry.parts ??= graphemes(entry.name);
        if (Math.abs(parts.length - entry.parts.length) > bestDistance) continue;
        const delta = distance(parts, entry.parts, bestDistance);
        if (delta > bestDistance) continue;
        if (delta < bestDistance) { best = new Set(); bestDistance = delta; }
        best.add(entry.answer);
      }
    }
  }
  if (best.size === 0 && looseSkel.length >= 4) {
    const thLimit = looseSkel.length >= 7 ? 2 : 1;
    let thBest = new Set(), thBestDist = thLimit;
    const parts = graphemes(looseSkel);
    const qMask = charMask(looseSkel);
    for (let length = Math.max(4, looseSkel.length - thLimit); length <= looseSkel.length + thLimit; length++) {
      if (Math.abs(length - looseSkel.length) > thBestDist) continue;
      for (const entry of thaiByLength.get(length) || []) {
        if (thBestDist === 1 && looseSkel[0] !== entry.name[0] && looseSkel.at(-1) !== entry.name.at(-1)) continue;
        if (popcountDiff(qMask, entry.mask) > thBestDist * 2) continue;
        entry.parts ??= graphemes(entry.name);
        if (Math.abs(parts.length - entry.parts.length) > thBestDist) continue;
        const delta = distance(parts, entry.parts, thBestDist);
        if (delta > thBestDist) continue;
        if (delta < thBestDist) { thBest = new Set(); thBestDist = delta; }
        thBest.add(entry.answer);
      }
    }
    best = thBest;
  }
  if (best.size === 1) return { kind: 'correction', answer: best.values().next().value };
  if (best.size > 1 && best.size <= 6) {
    const qCons = enConsonantSkeleton(value);
    if (qCons.length >= 2) {
      const narrowed = [...best].filter(ans =>
        [ans.label, ...(ans.aliases || [])].some(n => enConsonantSkeleton(normalize(n)) === qCons)
      );
      if (narrowed.length === 1) return { kind: 'correction', answer: narrowed[0] };
    }
  }
  return { kind: 'unknown' };
}

export function matchAnswer(question, raw) {
  const value = normalize(raw);
  if (!value) return { kind: 'empty' };
  const index = answerIndex(question.answers);
  const direct = matchCore(index, value);
  if (direct.kind !== 'unknown') return direct;
  // Support "Song Title - Artist" / "Artist - Song Title" inputs in music questions
  if (question?.theme === 'music' && /\s+[-–—]\s+/.test(String(raw))) {
    const segs = String(raw).split(/\s+[-–—]\s+/).map(normalize).filter(s => s.length >= 2);
    let fallbackCorrection = null;
    for (const seg of segs) {
      const hit = matchCore(index, seg);
      if (hit.kind === 'exact') return hit;
      if (hit.kind === 'correction' && !fallbackCorrection) fallbackCorrection = hit;
    }
    if (fallbackCorrection) return fallbackCorrection;
  }
  return direct;
}
export function createSession({ mode, bank, questions, date = dayKey(), now = Date.now(), run = 1, group = 'classic' }) {
  if (questions.length !== 7) throw new Error('A dive needs exactly seven questions.');
  if (validateSurveyBank(bank).length) throw new Error('A dive requires survey-backed questions.');
  const bankIds = new Set(bank.questions.map(item => item.id));
  if (questions.some(q => validateSurveyQuestion(q).length || !bankIds.has(q.id)))
    throw new Error('A dive requires survey-backed questions.');
  return {
    schemaVersion: 1, id: mode + ':' + date + ':' + run + ':' + now, mode,
    ...(mode === 'endless' && group && group !== 'classic' ? { group } : {}),
    date, run,
    bankVersion: bank.version, scoringMethod: bank.scoringMethod || HYBRID_SCORING, startedAt: now, phase: 'preview', index: 0,
    phaseUntil: now + PREVIEW_MS, deadline: now + PREVIEW_MS + ANSWER_MS,
    questions: questions.map(q => isTrustedPreparedQuestion(q) ? q : structuredClone(q)), results: [], score: 0, depth: 0,
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
