import { normalize } from '../src/answers.js';

const UA = 'krillion-th-analytics/1.0.9 (https://1inkrillionth.vercel.app)';

export function suggestTierFromMetrics(scope, { thPv = 0, thLl = 0, wdSitelinks = 0, hasArticle = false } = {}) {
  if (!hasArticle && !wdSitelinks && !thPv) return null;
  if (scope === 'thai') {
    if (thPv >= 6000 || (wdSitelinks >= 25 && thPv >= 2500)) return 'plankton';
    if (thPv >= 1200 || (wdSitelinks >= 12 && thPv >= 400)) return 'schooler';
    if (thPv >= 220 || wdSitelinks >= 5 || thLl >= 3) return 'rare';
    if (thPv >= 35 || wdSitelinks >= 2) return 'deepcut';
    return 'krillion';
  }
  if (wdSitelinks >= 70 || thPv >= 4500) return 'plankton';
  if (wdSitelinks >= 30 || thPv >= 900) return 'schooler';
  if (wdSitelinks >= 10 || thPv >= 150) return 'rare';
  if (wdSitelinks >= 4 || thPv >= 25) return 'deepcut';
  return 'krillion';
}

async function fetchJson(url, fetchFn = fetch) {
  try {
    const r = await fetchFn(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const DOMAIN_HINTS = [
  { match: /movie|film/i, preferRe: /film|animated|movie|ภาพยนตร์|แอนิเมชัน/i, rejectRe: /video game|soundtrack|album|episode/i },
  { match: /cat/i, preferRe: /cat|feline|breed|coat|แมว/i, rejectRe: /fish|gourami|plant|flower|ปลา/i },
  { match: /dog/i, preferRe: /dog|canine|hound|terrier|สุนัข|หมา/i, rejectRe: /fish|plant/i },
  { match: /city|cities/i, preferRe: /city|capital|municipality|prefecture|town|เมือง|เทศบาล|จังหวัด/i, rejectRe: /person|admiral|general|บุคคล|นายพล/i },
  { match: /temple/i, preferRe: /wat|temple|monastery|วัด|พุทธศาสนสถาน/i, rejectRe: /film|ละคร/i },
  { match: /fish/i, preferRe: /fish|species|goby|ปลา/i, rejectRe: /folklore|drama|ละคร|ภาพยนตร์/i },
  { match: /cartoon|anime/i, preferRe: /character|fictional|manga|anime|ตัวละคร|การ์ตูน/i, rejectRe: /prefecture|city|จังหวัด/i },
];

function stripThaiMarks(s) {
  return normalize(s).replace(/[\u0E47-\u0E4E]/g, '').replace(/\s+/g, '');
}

function titleSimilarity(a, b) {
  const sa = stripThaiMarks(a).replace(/^(จังหวัด|เทศบาลนคร|นคร|สถานี|วัด|แมว|ปลา|ต้น)/, '');
  const sb = stripThaiMarks(b).replace(/^(จังหวัด|เทศบาลนคร|นคร|สถานี|วัด|แมว|ปลา|ต้น)/, '');
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  if (sb.includes(sa) && sa.length / sb.length >= 0.65) return 0.85;
  if (sa.includes(sb) && sb.length / sa.length >= 0.65) return 0.85;
  const maxLen = Math.max(sa.length, sb.length);
  const dp = Array.from({ length: sb.length + 1 }, (_, j) => j);
  for (let i = 1; i <= sa.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= sb.length; j++) {
      const cur = dp[j];
      dp[j] = sa[i - 1] === sb[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = cur;
    }
  }
  return Math.max(0, 1 - dp[sb.length] / maxLen);
}

export async function lookupThaiWikipedia(term, fetchFn = fetch, questionId = '') {
  const clean = String(term || '').trim();
  if (!clean) return null;

  // 1. Exact/redirect title lookup first
  const directUrl = 'https://th.wikipedia.org/w/api.php?action=query&redirects=1'
    + '&prop=pageviews|langlinkscount|description|extracts&exintro=1&explaintext=1&exsentences=2'
    + '&titles=' + encodeURIComponent(clean) + '&format=json';
  const direct = await fetchJson(directUrl, fetchFn);
  const pages = Object.values(direct?.query?.pages || {});
  const directHit = pages.find(p => !p.missing && p.pageid);

  if (directHit) {
    const pv = Object.values(directHit.pageviews || {}).reduce((s, v) => s + (v || 0), 0);
    const redirectedFrom = direct?.query?.redirects?.[0]?.from || '';
    const domain = DOMAIN_HINTS.find(d => d.match.test(questionId));
    const text = `${directHit.description || ''} ${directHit.extract || ''}`;
    if (!domain?.rejectRe?.test(text) || redirectedFrom) {
      return {
        foundBy: redirectedFrom ? 'redirect' : 'exact',
        redirectedFrom,
        title: directHit.title,
        description: directHit.description || '',
        extract: (directHit.extract || '').slice(0, 220),
        pv,
        ll: directHit.langlinkscount || 0,
      };
    }
  }

  // 2. Fallback: search Thai Wikipedia (top 5) and require strong title similarity + domain compatibility
  const searchUrl = 'https://th.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=5'
    + '&gsrsearch=' + encodeURIComponent(clean)
    + '&prop=pageviews|langlinkscount|description|extracts&exintro=1&explaintext=1&exsentences=2&format=json';
  const search = await fetchJson(searchUrl, fetchFn);
  const domain = DOMAIN_HINTS.find(d => d.match.test(questionId));
  const searchPages = Object.values(search?.query?.pages || [])
    .filter(p => !p.missing)
    .map(p => {
      const sim = titleSimilarity(clean, p.title);
      const descText = `${p.title} ${p.description || ''} ${p.extract || ''}`;
      const bonus = domain?.preferRe?.test(descText) ? 0.15 : 0;
      const penalty = domain?.rejectRe?.test(descText) ? -0.4 : 0;
      return { p, sim, score: sim + bonus + penalty };
    })
    .filter(x => x.sim >= 0.62 && x.score >= 0.62)
    .sort((a, b) => b.score - a.score);

  const best = searchPages[0]?.p;
  if (!best) return null;

  const pv = Object.values(best.pageviews || {}).reduce((s, v) => s + (v || 0), 0);
  return {
    foundBy: 'search',
    redirectedFrom: '',
    title: best.title,
    description: best.description || '',
    extract: (best.extract || '').slice(0, 220),
    pv,
    ll: best.langlinkscount || 0,
  };
}

export async function lookupWikidata(term, { lang = 'th', fetchFn = fetch, questionId = '' } = {}) {
  const clean = String(term || '').trim();
  if (!clean) return null;
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(clean)}&language=${lang}&uselang=${lang}&limit=5&format=json`;
  const sr = await fetchJson(searchUrl, fetchFn);
  let candidates = sr?.search || [];
  if (!candidates.length && lang === 'th') {
    const enUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(clean)}&language=en&uselang=th&limit=5&format=json`;
    const enSr = await fetchJson(enUrl, fetchFn);
    candidates = enSr?.search || [];
  }
  const domain = DOMAIN_HINTS.find(d => d.match.test(questionId));
  const ranked = candidates
    .map(c => {
      const txt = `${c.label || ''} ${c.description || ''}`;
      const sim = titleSimilarity(clean, c.label || c.match?.text || '');
      const bonus = domain?.preferRe?.test(txt) ? 0.25 : 0;
      const penalty = domain?.rejectRe?.test(txt) ? -0.5 : 0;
      return { c, sim, score: sim + bonus + penalty };
    })
    .filter(x => x.sim >= 0.55 && x.score >= 0.45)
    .sort((a, b) => b.score - a.score);
  const hit = ranked[0]?.c;
  if (!hit?.id) return null;

  const entUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(hit.id)}&props=labels|descriptions|sitelinks&languages=th|en&format=json`;
  const entJson = await fetchJson(entUrl, fetchFn);
  const ent = entJson?.entities?.[hit.id];
  if (!ent) return null;

  return {
    qid: hit.id,
    labelTh: ent.labels?.th?.value || '',
    labelEn: ent.labels?.en?.value || '',
    description: ent.descriptions?.th?.value || ent.descriptions?.en?.value || hit.description || '',
    sitelinks: Object.keys(ent.sitelinks || {}).length,
  };
}

function doesTextMatchAnyAnswer(question, candidateTexts) {
  const targets = candidateTexts.map(t => normalize(t)).filter(Boolean);
  if (!targets.length || !question?.answers) return null;
  for (const ans of question.answers) {
    const allNames = [ans.label, ...(ans.aliases || [])].map(normalize);
    for (const t of targets) {
      if (allNames.includes(t)) return ans;
    }
  }
  return null;
}

export async function researchRecommendations(report, bank, { fetchFn = fetch, maxItems = 40 } = {}) {
  const questionById = new Map((bank?.questions || []).map(q => [q.id, q]));
  const rec = report?.recommendations || { newAnswers: [], newAliases: [] };

  const enrichedNewAnswers = [];
  const discoveredAliases = [];

  for (const item of rec.newAnswers.slice(0, maxItems)) {
    const q = questionById.get(item.questionId);
    const probeText = item.submittedText || item.label;
    const [thWp, wd] = await Promise.all([
      lookupThaiWikipedia(probeText, fetchFn, item.questionId),
      lookupWikidata(probeText, { lang: /^[a-z0-9\s\-']+$/i.test(probeText) ? 'en' : 'th', fetchFn, questionId: item.questionId }),
    ]);

    // Did Wikipedia redirect OR canonical high-similarity Wikidata match resolve to an EXISTING answer?
    const wdSafe = wd && titleSimilarity(probeText, wd.labelTh || wd.labelEn || '') >= 0.85 ? wd : null;
    const resolvedForms = [thWp?.title, wdSafe?.labelTh, wdSafe?.labelEn].filter(Boolean);
    const matchedExisting = doesTextMatchAnyAnswer(q, resolvedForms);

    const metrics = {
      thPv: thWp?.pv || 0,
      thLl: thWp?.ll || 0,
      wdSitelinks: wd?.sitelinks || 0,
      hasArticle: Boolean(thWp?.title),
    };
    const evidenceTier = suggestTierFromMetrics(q?.scope || 'world', metrics);

    if (matchedExisting) {
      discoveredAliases.push({
        questionId: item.questionId,
        prompt: item.prompt,
        alias: probeText,
        targetId: matchedExisting.id,
        targetLabel: matchedExisting.label,
        targetTier: matchedExisting.tier,
        reason: `Research พบ redirect/ชื่อตรงกับคำหลัก "${matchedExisting.label}" (${thWp?.title || wd?.qid || ''})`,
        sources: item.sources,
        research: { thWp, wd },
      });
    } else {
      enrichedNewAnswers.push({
        ...item,
        researchedTier: evidenceTier || item.suggestedTier,
        evidenceSummary: {
          wpTitle: thWp?.title || '',
          wpFoundBy: thWp?.foundBy || '',
          wpPv: thWp?.pv ?? null,
          wpLl: thWp?.ll ?? null,
          wpExtract: thWp?.extract || '',
          wdQid: wd?.qid || '',
          wdLabelTh: wd?.labelTh || '',
          wdLabelEn: wd?.labelEn || '',
          wdDescription: wd?.description || '',
          wdSitelinks: wd?.sitelinks ?? null,
          needsWebVerify: !thWp && (!wd || wd.sitelinks < 3),
        },
      });
    }
    await new Promise(res => setTimeout(res, 120));
  }

  const enrichedNewAliases = [];
  for (const al of rec.newAliases.slice(0, maxItems)) {
    const thWp = await lookupThaiWikipedia(al.alias, fetchFn);
    enrichedNewAliases.push({
      ...al,
      evidenceSummary: {
        wpTitle: thWp?.title || '',
        wpRedirectedFrom: thWp?.redirectedFrom || '',
        wpPv: thWp?.pv ?? null,
      },
    });
    await new Promise(res => setTimeout(res, 100));
  }

  // Keep original newAliases + append any alias discovered via Wikipedia redirect / Wikidata resolution!
  return {
    ...report,
    researchedAt: new Date().toISOString(),
    recommendations: {
      newAnswers: enrichedNewAnswers,
      newAliases: [...enrichedNewAliases, ...discoveredAliases],
      reviewOrSkip: rec.reviewOrSkip || [],
    },
  };
}
