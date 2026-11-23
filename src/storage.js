export const STORAGE_KEY = 'krillion-th.v1';
export const DEFAULT_SETTINGS = Object.freeze({
  muted: false, lowPower: false, colorblind: false, corrections: true, clearRejected: false, shareLink: false
});
export function emptySave() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, daily: {}, endless: null, endlessByBank: {},
    history: [], seen: [], run: 0, runByGroup: {}, character: 'krillion', currentBankVersion: null, resumeSessionId: null,
    clientId: '', telemetrySent: [], seenPatchVersion: '' };
}
export function ensureClientId(save) {
  if (save.clientId && typeof save.clientId === 'string') return save.clientId;
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? 'c_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : 'c_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  save.clientId = id;
  return id;
}
function slimQuestionSnapshot(question, matchedIds) {
  const picked = [];
  const seen = new Set();
  const add = answer => {
    if (!answer || seen.has(answer.id)) return;
    seen.add(answer.id);
    picked.push(answer);
  };
  for (const answer of question.answers) if (matchedIds.has(answer.id)) add(answer);
  if (question.curated) {
    add(question.answers.find(a => a.tier === 'plankton'));
    add(question.answers.find(a => a.tier === 'krillion'));
  } else {
    const val = a => question.survey?.scale === 'rating-1-to-7' ? a.rating : a.percent;
    let hi = question.answers[0], lo = question.answers[0];
    for (const a of question.answers) {
      if (val(a) > val(hi)) hi = a;
      if (val(a) < val(lo)) lo = a;
    }
    add(hi); add(lo);
  }
  for (const answer of question.answers) {
    if (picked.length >= 5) break;
    add(answer);
  }
  return { ...question, answers: picked };
}

export function readSave(storage = globalThis.localStorage, bank = null) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!data || data.version !== 1 || !data.daily || typeof data.daily !== 'object' ||
      Array.isArray(data.daily) || !Array.isArray(data.history)) return emptySave();
    if (data.snapshotEncoding) {
      if (data.snapshotEncoding !== 'question-table-v1' || !Array.isArray(data.questionSnapshots)) return emptySave();
      const bankById = bank?.questions ? new Map(bank.questions.map(q => [q.id, q])) : null;
      const resolveSnapshot = index => {
        if (!Number.isInteger(index)) return undefined;
        const entry = data.questionSnapshots[index];
        if (!entry) return undefined;
        if (entry.$bankRef) {
          if (bankById && bank.version === entry.bankVersion && bankById.has(entry.$bankRef)) {
            const liveQ = bankById.get(entry.$bankRef);
            return Object.isFrozen(liveQ) ? liveQ : structuredClone(liveQ);
          }
          return entry.fallback;
        }
        return entry;
      };
      const expand = session => !session || !Array.isArray(session.questions) ? session : {
        ...session, questions: session.questions.map(resolveSnapshot)
      };
      data.daily=Object.fromEntries(Object.entries(data.daily).map(([key,session])=>[key,expand(session)]));
      data.endless=expand(data.endless);
      data.endlessByBank=Object.fromEntries(Object.entries(data.endlessByBank||{}).map(([key,session])=>[key,expand(session)]));
      data.history=data.history.map(expand);
      delete data.snapshotEncoding;delete data.questionSnapshots;
    }
    return { ...emptySave(), ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings },
      history: data.history.filter(s => validSession(s) && s.phase === 'complete'),
      endlessByBank: data.endlessByBank && typeof data.endlessByBank === 'object' && !Array.isArray(data.endlessByBank) ? data.endlessByBank : {},
      runByGroup: data.runByGroup && typeof data.runByGroup === 'object' && !Array.isArray(data.runByGroup) ? data.runByGroup : {},
      seen: Array.isArray(data.seen) ? data.seen : [] };
  } catch { return emptySave(); }
}
export const dailySlot = (date,bankVersion) => date+'@'+bankVersion;
export const endlessSlot = (bankVersion, groupId = 'classic') => !groupId || groupId === 'classic' ? bankVersion : bankVersion + '@' + groupId;
export function prepareSaveForBank(saved,bank) {
  const cloneQuestion = q => Object.isFrozen(q) ? q : structuredClone(q);
  const cloneSession = s => {
    if (!s || typeof s !== 'object') return s;
    const { questions, ...rest } = s;
    return { ...structuredClone(rest), ...(Array.isArray(questions) ? { questions: questions.map(cloneQuestion) } : {}) };
  };
  const next = {
    ...saved,
    settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
    daily: Object.fromEntries(Object.entries(saved.daily || {}).map(([k, v]) => [k, cloneSession(v)])),
    endless: cloneSession(saved.endless),
    endlessByBank: Object.fromEntries(Object.entries(saved.endlessByBank || {}).map(([k, v]) => [k, cloneSession(v)])),
    history: Array.isArray(saved.history) ? saved.history.map(cloneSession) : [],
    seen: [...(saved.seen || [])],
    runByGroup: { ...(saved.runByGroup || {}) },
    telemetrySent: [...(saved.telemetrySent || [])],
  };
  for(const [key,session] of Object.entries(next.daily)) {
    if(!validSession(session)||key.includes('@'))continue;
    const target=dailySlot(session.date,session.bankVersion);
    if(!next.daily[target])next.daily[target]=session;
    delete next.daily[key];
  }
  if(validSession(next.endless)) {
    const slot=endlessSlot(next.endless.bankVersion, next.endless.group || 'classic');
    const previous=next.endlessByBank[slot];
    if(!previous||previous.startedAt<=next.endless.startedAt)next.endlessByBank[slot]=next.endless;
  }
  if(next.currentBankVersion!==bank.version) {
    next.currentBankVersion=bank.version;
    next.resumeSessionId=null;
    const ids=new Set(bank.questions.map(q=>q.id));
    next.seen=next.seen.filter(id=>ids.has(id));
  }
  next.endless=next.endlessByBank[bank.version]||null;
  return next;
}
export function currentSavedSession(saved,mode,date,bankVersion,groupId='classic') {
  const candidate=mode==='daily' ? saved.daily[dailySlot(date,bankVersion)] : saved.endlessByBank?.[endlessSlot(bankVersion, groupId)];
  return validSession(candidate)&&candidate.bankVersion===bankVersion ? candidate : null;
}
export function savedSessions(saved) {
  return [...new Map([...Object.values(saved.daily),...Object.values(saved.endlessByBank||{})]
    .filter(validSession).map(session=>[session.id,session])).values()];
}
export function writeSave(save, storage = globalThis.localStorage, bank = null) {
  try {
    // Store each immutable question snapshot once, and compact live-bank
    // questions into lightweight bank references with a minimal fallback so
    // thousand-answer categories never exceed browser localStorage limits.
    const bankById = bank?.questions ? new Map(bank.questions.map(q => [q.id, q])) : null;
    const matchedByQuestion = new Map();
    const recordMatches = session => {
      if (!validSession(session)) return;
      for (const result of session.results || []) {
        if (!result?.questionId || !result?.answerId) continue;
        if (!matchedByQuestion.has(result.questionId)) matchedByQuestion.set(result.questionId, new Set());
        matchedByQuestion.get(result.questionId).add(result.answerId);
      }
    };
    for (const s of Object.values(save.daily || {})) recordMatches(s);
    recordMatches(save.endless);
    for (const s of Object.values(save.endlessByBank || {})) recordMatches(s);
    for (const s of save.history || []) recordMatches(s);

    const questionSnapshots=[], references=new Map();
    const pack = session => !validSession(session) ? session : {
      ...session, questions:session.questions.map(question=>{
        const bankQ = bankById && session.bankVersion === bank.version ? bankById.get(question.id) : null;
        if (bankQ && bankQ.prompt === question.prompt && bankQ.answers.length === question.answers.length &&
          bankQ.questionVersion === question.questionVersion) {
          const refKey = '$bankRef:' + bank.version + ':' + question.id;
          if (!references.has(refKey)) {
            references.set(refKey, questionSnapshots.length);
            questionSnapshots.push({
              $bankRef: question.id,
              bankVersion: bank.version,
              fallback: slimQuestionSnapshot(question, matchedByQuestion.get(question.id) || new Set())
            });
          }
          return references.get(refKey);
        }
        const text=JSON.stringify(question);
        if(!references.has(text)) {
          references.set(text,questionSnapshots.length);questionSnapshots.push(question);
        }
        return references.get(text);
      })
    };
    const packed={...save,snapshotEncoding:'question-table-v1',questionSnapshots,
      daily:Object.fromEntries(Object.entries(save.daily).map(([key,session])=>[key,pack(session)])),
      endless:pack(save.endless),
      endlessByBank:Object.fromEntries(Object.entries(save.endlessByBank||{}).map(([key,session])=>[key,pack(session)])),
      history:save.history.map(pack)};
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(packed));
      return true;
    } catch {
      let slimmed = false;
      for (let i = 0; i < questionSnapshots.length; i++) {
        const entry = questionSnapshots[i];
        if (entry && !entry.$bankRef && Array.isArray(entry.answers) && entry.answers.length > 25) {
          questionSnapshots[i] = slimQuestionSnapshot(entry, matchedByQuestion.get(entry.id) || new Set());
          slimmed = true;
        }
      }
      if (!slimmed) return false;
      storage.setItem(STORAGE_KEY, JSON.stringify(packed));
      return true;
    }
  } catch { return false; }
}
export function validSession(session) {
  return !!(session && session.schemaVersion === 1 && Array.isArray(session.questions) && session.questions.length === 7 &&
    session.questions.every(q => q && typeof q.prompt === 'string' && Array.isArray(q.answers) && q.answers.length >= 5) &&
    Array.isArray(session.results) && session.results.length <= 7 && Number.isInteger(session.index) &&
    session.index >= 0 && session.index <= 6 &&
    ['preview', 'answer', 'correction', 'sinking', 'reveal', 'complete'].includes(session.phase) &&
    Number.isFinite(session.deadline) && Number.isFinite(session.depth) && Number.isFinite(session.score) &&
    (session.phase !== 'complete' || session.results.length === 7));
}
