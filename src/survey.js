import { answerForms, normalize } from './answers.js';

export const SURVEY_SCORING = 'published-survey-relative-rank-v1';
export const HYBRID_SCORING = 'hybrid-survey-and-curated-v1';
export const SURVEY_TIERS = Object.freeze(['plankton', 'schooler', 'rare', 'deepcut', 'krillion']);
export const MIN_PLAYABLE_ANSWERS = 21;
export const BROAD_ANSWER_TARGET = 100;
const VALID_TIERS = new Set(SURVEY_TIERS);
const VALID_SCORING = new Set([SURVEY_SCORING, HYBRID_SCORING]);
const TRUSTED_PREPARED_QUESTIONS = new WeakSet();
const TRUSTED_PREPARED_BANKS = new WeakSet();
const PREPARED_TIER_MAPS = new WeakMap();
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const isHttps = value => {
  try { return new URL(value).protocol === 'https:'; }
  catch { return false; }
};

export const surveyValue = (question, answer) => question.survey?.scale === 'rating-1-to-7'
  ? answer.rating : answer.percent;

export function starterExample(question) {
  if (!question?.answers?.length) return null;
  if (question.curated) return question.answers.find(a => a.tier === 'plankton') || question.answers[0];
  return question.answers.reduce((best, answer) => surveyValue(question, answer) > surveyValue(question, best) ? answer : best);
}

export function curatedReason(question, answer, tier) {
  return answer?.reason || question?.curated?.tierReasons?.[tier || answer?.tier] || '';
}

function freezeQuestionTree(question) {
  if (question.survey) Object.freeze(question.survey);
  if (question.curated) {
    if (question.curated.tierReasons) Object.freeze(question.curated.tierReasons);
    if (question.curated.references) {
      question.curated.references.forEach(ref => Object.freeze(ref));
      Object.freeze(question.curated.references);
    }
    Object.freeze(question.curated);
  }
  for (const answer of question.answers) {
    if (Array.isArray(answer.aliases)) Object.freeze(answer.aliases);
    Object.freeze(answer);
  }
  Object.freeze(question.answers);
  return Object.freeze(question);
}

// Validates that either published-survey or curated-familiarity provenance is
// complete and internally consistent. Reviewing source accuracy/permissions
// remains a human research task.
export function validateSurveyQuestion(q) {
  if (q && TRUSTED_PREPARED_QUESTIONS.has(q)) return [];
  const errors = [];
  if (!q || typeof q !== 'object') return ['Missing question'];
  const name = q.id || '(missing question id)';
  for (const field of ['id', 'theme', 'prompt', 'hint'])
    if (!nonempty(q[field])) errors.push(name + ': missing ' + field);
  if (!['thai', 'world'].includes(q.scope)) errors.push(name + ': invalid scope');
  const hasSurvey = Boolean(q.survey && typeof q.survey === 'object');
  const hasCurated = Boolean(q.curated && typeof q.curated === 'object');
  if (hasSurvey === hasCurated) {
    errors.push(name + ': must define either survey or curated metadata');
  } else if (hasSurvey) {
    const s = q.survey;
    for (const field of ['publisher', 'fieldwork', 'population', 'sampleNote', 'sourceQuestion', 'metric', 'coverage'])
      if (!nonempty(s[field])) errors.push(name + ': missing survey ' + field);
    if (s.sampleSize !== null && (!Number.isInteger(s.sampleSize) || s.sampleSize <= 0)) errors.push(name + ': invalid survey sample size');
    if (s.scale !== undefined && s.scale !== 'rating-1-to-7') errors.push(name + ': unknown survey scale');
    if (s.licenseUrl !== undefined && !isHttps(s.licenseUrl)) errors.push(name + ': invalid license URL');
    if (!isHttps(s.url)) errors.push(name + ': invalid survey URL');
  } else {
    const c = q.curated;
    for (const field of ['basis', 'coverage'])
      if (!nonempty(c[field])) errors.push(name + ': missing curated ' + field);
    if (c.tierReasons !== undefined) {
      if (!c.tierReasons || typeof c.tierReasons !== 'object' || Array.isArray(c.tierReasons) ||
        Object.entries(c.tierReasons).some(([k, v]) => !VALID_TIERS.has(k) || !nonempty(v)))
        errors.push(name + ': invalid curated tierReasons');
    }
    if (c.references !== undefined) {
      if (!Array.isArray(c.references) || c.references.some(ref => !nonempty(ref?.label) || !isHttps(ref?.url)))
        errors.push(name + ': invalid curated references');
    }
  }
  if (!Array.isArray(q.answers) || q.answers.length < 5) return [...errors, name + ': needs at least five reported answers'];
  const ids = new Set(), names = new Map(), values = new Set(), tiers = new Set();
  for (const a of q.answers) {
    if (!a || !nonempty(a.id) || !nonempty(a.label) || !Array.isArray(a.aliases) || a.aliases.some(alias => !nonempty(alias))) {
      errors.push(name + ': invalid answer'); continue;
    }
    if (ids.has(a.id)) errors.push(name + ': duplicate answer ' + a.id);
    ids.add(a.id);
    if (hasSurvey) {
      const value = surveyValue(q, a);
      if (!Number.isFinite(value) || (q.survey?.scale === 'rating-1-to-7'
        ? value < 1 || value > 7 || a.percent !== undefined
        : value <= 0 || value > 100 || a.rating !== undefined)) errors.push(name + '/' + a.id + ': invalid measured value');
      else values.add(value);
    } else if (hasCurated) {
      if (!VALID_TIERS.has(a.tier)) errors.push(name + '/' + a.id + ': invalid curated tier');
      else tiers.add(a.tier);
      if (!nonempty(a.reason) && !nonempty(q.curated?.tierReasons?.[a.tier])) errors.push(name + '/' + a.id + ': missing curated reason');
      if (a.percent !== undefined || a.rating !== undefined) errors.push(name + '/' + a.id + ': curated answer cannot include survey metrics');
    }
    for (const label of [a.label, ...a.aliases]) {
      const val = normalize(label);
      const compact = val.replace(/[.\s]/g, '');
      for (let pass = 0; pass < (compact === val ? 1 : 2); pass++) {
        const form = pass === 0 ? val : compact;
        if (!form) errors.push(name + ': empty answer alias');
        const prev = names.get(form);
        if (prev !== undefined && prev !== a.id) errors.push(name + ': ambiguous alias ' + label);
        names.set(form, a.id);
      }
    }
  }
  if (hasSurvey && values.size < 2) errors.push(name + ': at least two distinct measured values are needed');
  if (hasCurated) {
    if (tiers.size < 2) errors.push(name + ': curated questions need at least two distinct tiers');
    if (!tiers.has('plankton') || !tiers.has('krillion')) errors.push(name + ': curated questions need plankton and krillion tiers');
  }
  return errors;
}

export function validateSurveyBank(bank) {
  if (bank && TRUSTED_PREPARED_BANKS.has(bank)) return [];
  if (!bank || !nonempty(bank.version) || !VALID_SCORING.has(bank.scoringMethod) || !Array.isArray(bank.questions))
    return ['Missing survey bank version, scoring method or questions'];
  const errors = [], ids = new Set();
  for (const q of bank.questions) {
    errors.push(...validateSurveyQuestion(q));
    if (Array.isArray(q?.answers) && q.answers.length < MIN_PLAYABLE_ANSWERS)
      errors.push(q.id + ': playable questions need at least ' + MIN_PLAYABLE_ANSWERS + ' measured answers');
    if (ids.has(q?.id)) errors.push('Duplicate question: ' + q.id);
    ids.add(q?.id);
  }
  if (bank.questions.filter(q => q?.scope === 'thai').length < 4) errors.push('Not enough survey-backed Thai questions');
  if (bank.questions.filter(q => q?.scope === 'world').length < 4) errors.push('Not enough survey-backed general questions');
  return errors;
}

// Relative rank uses only measured values from this question's survey; curated
// questions return their validated familiarity tier.
export function surveyTier(question, answerId) {
  if (question && PREPARED_TIER_MAPS.has(question)) {
    return PREPARED_TIER_MAPS.get(question).get(answerId) ?? null;
  }
  return surveyTiers(question).get(answerId) ?? null;
}

export function surveyTiers(question) {
  if (question && PREPARED_TIER_MAPS.has(question)) {
    return PREPARED_TIER_MAPS.get(question);
  }
  return validateSurveyQuestion(question).length ? new Map() : tiersFor(question);
}

function tiersFor(question) {
  if (question.curated) return new Map(question.answers.map(answer => [answer.id, answer.tier]));
  const values = [...new Set(question.answers.map(a => surveyValue(question, a)))].sort((a, b) => b - a);
  const ranks = new Map(values.map((value, rank) => [value, SURVEY_TIERS[Math.floor(rank * (SURVEY_TIERS.length - 1) / (values.length - 1))]]));
  return new Map(question.answers.map(answer => [answer.id, ranks.get(surveyValue(question, answer))]));
}

export function prepareSurveyBank(raw) {
  const errors = validateSurveyBank(raw);
  if (errors.length) throw new Error('คลังผลสำรวจไม่ผ่านการตรวจ: ' + errors[0]);
  const questions = raw.questions.map(q => {
    const tiers = tiersFor(q);
    const clonedQ = q.survey
      ? { ...q, survey: { ...q.survey }, answers: q.answers.map(a => ({ ...a, aliases: [...a.aliases], tier: tiers.get(a.id) })) }
      : { ...q, curated: structuredClone(q.curated), answers: q.answers.map(a => ({ ...a, aliases: [...a.aliases] })) };
    const frozenQ = freezeQuestionTree(clonedQ);
    TRUSTED_PREPARED_QUESTIONS.add(frozenQ);
    PREPARED_TIER_MAPS.set(frozenQ, tiers);
    return frozenQ;
  });
  Object.freeze(questions);
  const bank = Object.freeze({ ...raw, questions });
  TRUSTED_PREPARED_BANKS.add(bank);
  return bank;
}

export function isTrustedPreparedQuestion(question) {
  return Boolean(question && TRUSTED_PREPARED_QUESTIONS.has(question));
}

export function isSurveySession(session) {
  return !!(session && VALID_SCORING.has(session.scoringMethod) && Array.isArray(session.questions) &&
    session.questions.length === 7 && session.questions.every(q => validateSurveyQuestion(q).length === 0));
}
