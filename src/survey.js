import { answerForms } from './answers.js';

export const SURVEY_SCORING = 'published-survey-relative-rank-v1';
export const SURVEY_TIERS = Object.freeze(['plankton', 'schooler', 'rare', 'deepcut', 'krillion']);
export const MIN_PLAYABLE_ANSWERS = 9;
export const BROAD_ANSWER_TARGET = 100;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export const surveyValue = (question, answer) => question.survey?.scale === 'rating-1-to-7'
  ? answer.rating : answer.percent;

// This checks that evidence is present and internally consistent; reviewing the
// published source and its permission to reuse remains a human research task.
export function validateSurveyQuestion(q) {
  const errors = [];
  if (!q || typeof q !== 'object') return ['Missing question'];
  const name = q.id || '(missing question id)';
  for (const field of ['id', 'theme', 'prompt', 'hint'])
    if (!nonempty(q[field])) errors.push(name + ': missing ' + field);
  if (!['thai', 'world'].includes(q.scope)) errors.push(name + ': invalid scope');
  const s = q.survey;
  if (!s || typeof s !== 'object') errors.push(name + ': missing survey');
  else {
    for (const field of ['publisher', 'fieldwork', 'population', 'sampleNote', 'sourceQuestion', 'metric', 'coverage'])
      if (!nonempty(s[field])) errors.push(name + ': missing survey ' + field);
    if (s.sampleSize !== null && (!Number.isInteger(s.sampleSize) || s.sampleSize <= 0)) errors.push(name + ': invalid survey sample size');
    if (s.scale !== undefined && s.scale !== 'rating-1-to-7') errors.push(name + ': unknown survey scale');
    if (s.licenseUrl !== undefined) {
      try { if (new URL(s.licenseUrl).protocol !== 'https:') throw new Error(); }
      catch { errors.push(name + ': invalid license URL'); }
    }
    try { if (new URL(s.url).protocol !== 'https:') throw new Error(); }
    catch { errors.push(name + ': invalid survey URL'); }
  }
  if (!Array.isArray(q.answers) || q.answers.length < 5) return [...errors, name + ': needs at least five reported answers'];
  const ids = new Set(), names = new Map(), values = new Set();
  for (const a of q.answers) {
    if (!a || !nonempty(a.id) || !nonempty(a.label) || !Array.isArray(a.aliases) || a.aliases.some(alias => !nonempty(alias))) {
      errors.push(name + ': invalid answer'); continue;
    }
    if (ids.has(a.id)) errors.push(name + ': duplicate answer ' + a.id);
    ids.add(a.id);
    const value = surveyValue(q, a);
    if (!Number.isFinite(value) || (s?.scale === 'rating-1-to-7'
      ? value < 1 || value > 7 || a.percent !== undefined
      : value <= 0 || value > 100 || a.rating !== undefined)) errors.push(name + '/' + a.id + ': invalid measured value');
    else values.add(value);
    for (const label of [a.label, ...a.aliases]) for (const form of answerForms(label)) {
      if (!form) errors.push(name + ': empty answer alias');
      if (names.has(form) && names.get(form) !== a.id) errors.push(name + ': ambiguous alias ' + label);
      names.set(form, a.id);
    }
  }
  if (values.size < 2) errors.push(name + ': at least two distinct measured values are needed');
  return errors;
}

export function validateSurveyBank(bank) {
  if (!bank || !nonempty(bank.version) || bank.scoringMethod !== SURVEY_SCORING || !Array.isArray(bank.questions))
    return ['Missing survey bank version, scoring method or questions'];
  const errors = [], ids = new Set();
  for (const q of bank.questions) {
    errors.push(...validateSurveyQuestion(q));
    if (ids.has(q?.id)) errors.push('Duplicate question: ' + q.id);
    ids.add(q?.id);
  }
  if (bank.questions.filter(q => q?.scope === 'thai').length < 4) errors.push('Not enough survey-backed Thai questions');
  if (bank.questions.filter(q => q?.scope === 'world').length < 4) errors.push('Not enough survey-backed general questions');
  return errors;
}

// Relative rank uses only measured values from this question's survey.
// Identical values always receive identical scores; no unreported value
// is inferred. Scores are game points, not probabilities or respondent counts.
export function surveyTier(question, answerId) {
  return surveyTiers(question).get(answerId) ?? null;
}

export function surveyTiers(question) {
  return validateSurveyQuestion(question).length ? new Map() : tiersFor(question);
}

function tiersFor(question) {
  const values = [...new Set(question.answers.map(a => surveyValue(question, a)))].sort((a, b) => b - a);
  const ranks = new Map(values.map((value, rank) => [value, SURVEY_TIERS[Math.floor(rank * (SURVEY_TIERS.length - 1) / (values.length - 1))]]));
  return new Map(question.answers.map(answer => [answer.id, ranks.get(surveyValue(question, answer))]));
}

export function prepareSurveyBank(raw) {
  const errors = validateSurveyBank(raw);
  if (errors.length) throw new Error('คลังผลสำรวจไม่ผ่านการตรวจ: ' + errors[0]);
  const bank = structuredClone(raw);
  for (const question of bank.questions) {
    const tiers = tiersFor(question);
    for (const answer of question.answers) answer.tier = tiers.get(answer.id);
  }
  return bank;
}

export function isSurveySession(session) {
  return !!(session && session.scoringMethod === SURVEY_SCORING && Array.isArray(session.questions) &&
    session.questions.length === 7 && session.questions.every(q => validateSurveyQuestion(q).length === 0));
}
