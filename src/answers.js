const PURE_ASCII_NO_SPACE = /^[\x21-\x7e]+$/;
const PURE_ASCII = /^[\x20-\x7e]+$/;

export function normalize(text) {
  const s = String(text);
  if (!s) return '';
  if (PURE_ASCII_NO_SPACE.test(s)) {
    return s.includes('"') ? s.replace(/"/g, '').toLowerCase() : s.toLowerCase();
  }
  if (PURE_ASCII.test(s)) {
    let out = s.trim().toLowerCase();
    if (out.includes('"')) out = out.replace(/"/g, '');
    return out.includes('  ') ? out.replace(/ +/g, ' ') : out;
  }
  return s.normalize('NFC').trim().toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[“”"‘’]/g, '').replace(/\s+/g, ' ');
}

export function answerForms(text) {
  const value = normalize(text);
  const compact = value.replace(/[.\s]/g, '');
  return compact === value ? [value] : [value, compact];
}
