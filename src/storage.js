export const STORAGE_KEY = 'krillion-th.v1';
export const DEFAULT_SETTINGS = Object.freeze({
  muted: false, lowPower: false, colorblind: false, corrections: true, clearRejected: false, shareLink: false
});
export function emptySave() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, daily: {}, endless: null, endlessByBank: {},
    history: [], seen: [], run: 0, character: 'krillion', currentBankVersion: null, resumeSessionId: null };
}
export function readSave(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!data || data.version !== 1 || !data.daily || typeof data.daily !== 'object' ||
      Array.isArray(data.daily) || !Array.isArray(data.history)) return emptySave();
    if (data.snapshotEncoding) {
      if (data.snapshotEncoding !== 'question-table-v1' || !Array.isArray(data.questionSnapshots)) return emptySave();
      const expand = session => !session || !Array.isArray(session.questions) ? session : {
        ...session, questions: session.questions.map(index => Number.isInteger(index) ? data.questionSnapshots[index] : undefined)
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
      seen: Array.isArray(data.seen) ? data.seen : [] };
  } catch { return emptySave(); }
}
export const dailySlot = (date,bankVersion) => date+'@'+bankVersion;
export function prepareSaveForBank(saved,bank) {
  const next=structuredClone(saved);
  next.endlessByBank={...(next.endlessByBank||{})};
  for(const [key,session] of Object.entries(next.daily)) {
    if(!validSession(session)||key.includes('@'))continue;
    const target=dailySlot(session.date,session.bankVersion);
    if(!next.daily[target])next.daily[target]=session;
    delete next.daily[key];
  }
  if(validSession(next.endless)) {
    const previous=next.endlessByBank[next.endless.bankVersion];
    if(!previous||previous.startedAt<=next.endless.startedAt)next.endlessByBank[next.endless.bankVersion]=next.endless;
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
export function currentSavedSession(saved,mode,date,bankVersion) {
  const candidate=mode==='daily' ? saved.daily[dailySlot(date,bankVersion)] : saved.endlessByBank?.[bankVersion];
  return validSession(candidate)&&candidate.bankVersion===bankVersion ? candidate : null;
}
export function savedSessions(saved) {
  return [...new Map([...Object.values(saved.daily),...Object.values(saved.endlessByBank||{})]
    .filter(validSession).map(session=>[session.id,session])).values()];
}
export function writeSave(save, storage = globalThis.localStorage) {
  try {
    // Store each immutable question snapshot once, rather than copying hundreds
    // of accepted answers into every Daily, Endless and history entry.
    const questionSnapshots=[], references=new Map();
    const pack = session => !validSession(session) ? session : {
      ...session, questions:session.questions.map(question=>{
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
    storage.setItem(STORAGE_KEY, JSON.stringify(packed)); return true;
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
