export function normalize(text) {
  return String(text).normalize('NFC').trim().toLocaleLowerCase('th-TH')
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[“”"‘’]/g, '').replace(/\s+/g, ' ');
}

export function answerForms(text) {
  const value = normalize(text);
  return [...new Set([value, value.replace(/[.\s]/g, '')])];
}
