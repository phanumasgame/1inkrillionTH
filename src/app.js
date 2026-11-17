import { ANSWER_MS, PREVIEW_MS, TIME_ZONE, TIERS, TIER_ORDER, dayKey, selectDaily, selectEndless,
  createSession, tickSession, submitAnswer, confirmCorrection, skipRound, nextRound, shareText, validateBank } from './game.js';
import { readSave, writeSave, validSession, dailySlot, prepareSaveForBank, currentSavedSession, savedSessions } from './storage.js';
import { DiveAudio } from './audio.js';
import { OceanScene } from './scene.js';
import { descentDuration, PIXELS_PER_METER, METERS_PER_POINT } from './descent.js';
import { focusAnswer } from './input.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
let bank, evidence, audio, scene;
let save = readSave(), mode = location.pathname.startsWith('/unlimited') ? 'endless' : 'daily';
let session = null, view = 'home', composing = false, lastTick = -1, lastTierLine = null, landed = false, inputSaveTimer, toastTimer;
let modalRestoreFocus = null, modalKind = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const number = n => Number(n).toLocaleString('en-US');
const sprite = name => '/assets/art/' + name.replace(/-gold$/, '') + '.png';
const goldSprite = name => name.endsWith('-gold') ? ' class="gold-variant"' : '';
const safeUrl = url => /^https?:\/\//i.test(String(url)) ? esc(url) : '#';
const ACCESSIBLE_COLORS = {plankton:'#c3d8e3',tooclever:'#ff9f47',schooler:'#6cdcff',rare:'#7af3d8',deepcut:'#f5b5ff',krillion:'#ffeb70'};
const tierColor = tier => save.settings.colorblind ? ACCESSIBLE_COLORS[tier] : TIERS[tier].color;
function icon(name) {
  const shapes = {
    menu:'<path d="M3 3h10v2H3zm0 4h10v2H3zm0 4h10v2H3z"/>',
    sound:'<path d="M2 6h3l5-4v12l-5-4H2z"/><path d="M12 5h1v6h-1zm2-2h1v10h-1z"/>',
    muted:'<path d="M2 6h3l5-4v12l-5-4H2z"/><path d="m12 6 1-1 3 5-1 1zm3-1 1 1-3 5-1-1z"/>',
    settings:'<path fill-rule="evenodd" d="M6 0h4v3l2-1 2 2-1 2h3v4h-3l1 2-2 2-2-1v3H6v-3l-2 1-2-2 1-2H0V6h3L2 4l2-2 2 1zm2 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
    shirt:'<path d="M5 2 2 3 0 6l3 2 1-2v8h8V6l1 2 3-2-2-3-3-1-1 2H6z"/>'
  };
  return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">' + shapes[name] + '</svg>';
}

async function load() {
  try {
    const results = await Promise.allSettled([
      fetch('/data/questions.json').then(r => { if (!r.ok) throw new Error('คลังคำถามโหลดไม่สำเร็จ'); return r.json(); }),
      fetch('/assets/audio-cues.json').then(r => { if (!r.ok) throw new Error('ชุดเสียงโหลดไม่สำเร็จ'); return r.json(); }),
      fetch('/data/evidence.json').then(r => r.ok ? r.json() : null)
    ]);
    if (results[0].status !== 'fulfilled') throw results[0].reason;
    if (results[1].status !== 'fulfilled') throw results[1].reason;
    bank = results[0].value;
    const errors = validateBank(bank);
    if (errors.length) throw new Error('คลังคำถามไม่ผ่านการตรวจ: ' + errors[0]);
    save=prepareSaveForBank(save,bank);
    writeSave(save);
    const loadedEvidence = results[2].status === 'fulfilled' ? results[2].value : null;
    evidence = loadedEvidence?.bankVersion === bank.version ? loadedEvidence : null;
    audio = new DiveAudio(results[1].value, save.settings.muted);
    scene = new OceanScene((depth, frame) => {
      document.querySelectorAll('[data-live-depth]').forEach(el => { el.textContent = number(depth) + 'm'; });
      if (frame) updateDescent(frame);
    });
    applySettings();
    restoreCurrent();
    render();
    setInterval(pulse, 100);
    document.addEventListener('pointerdown', () => audio.unlock(), { passive:true });
    document.addEventListener('keydown', () => audio.unlock(), { passive:true });
  } catch (error) {
    app.innerHTML = '<div class="dialog" style="margin:20vh auto"><h2>Could not surface</h2><p class="thai">' +
      esc(error.message) + '</p><button class="primary-button" id="retry-load">TRY AGAIN ↻</button></div>';
    document.getElementById('retry-load').onclick = () => location.reload();
    console.error(error);
  }
}
function applySettings() {
  document.body.classList.toggle('low-power', save.settings.lowPower);
  document.body.classList.toggle('colorblind', save.settings.colorblind);
  audio?.setMuted(save.settings.muted);
}
function getSaved() {
  return currentSavedSession(save,mode,dayKey(),bank.version);
}
function restoreCurrent() {
  const requested=savedSessions(save).find(s=>s.id===save.resumeSessionId&&s.phase!=='complete');
  const saved = requested?.mode===mode ? requested : getSaved();
  session = validSession(saved) ? saved : null;
  view = session ? session.phase === 'complete' ? 'results' : 'play' : 'home';
  if (session) {
    session = tickSession(session);
    if (scene.reducedMotion && session.phase === 'sinking')
      session = { ...session, phaseUntil: Math.min(session.phaseUntil, Date.now() + 120) };
    lastTierLine = null; landed = false;
    if (session.phase === 'sinking' && session.results.at(-1)?.points) syncScene();
    else scene.set(session.depth, true, save.settings.lowPower, true);
    persist();
  } else scene.set(0, false, save.settings.lowPower, true);
}
function persist() {
  if (session && view !== 'history-result') {
    if (session.mode === 'daily') save.daily[dailySlot(session.date,session.bankVersion)] = session;
    else {
      save.endlessByBank[session.bankVersion]=session;
      if(session.bankVersion===bank.version)save.endless=session;
    }
    if (session.phase === 'complete' && !save.history.some(item => item.id === session.id)) {
      save.history.unshift(structuredClone(session)); save.history = save.history.slice(0, 40);
    }
  }
  for (const [date, stored] of Object.entries(save.daily)) {
    if (stored?.date !== dayKey() && stored?.phase === 'complete' && save.history.some(item => item.id === stored.id))
      delete save.daily[date];
  }
  const dates = Object.keys(save.daily).sort();
  for (const date of dates.slice(0, Math.max(0, dates.length - 35))) delete save.daily[date];
  if (!writeSave(save)) toast('บันทึกในเบราว์เซอร์ไม่ได้ กรุณาตรวจพื้นที่จัดเก็บหรือโหมดส่วนตัว');
}
function controls(active = false) {
  return '<button class="icon-btn menu-button" data-action="menu" aria-label="Open menu">' + icon('menu') + '</button>' +
    '<div class="toolbar"><button class="icon-btn" data-action="sound" aria-label="' + (save.settings.muted ? 'Turn sound on' : 'Turn sound off') + '">' +
    icon(save.settings.muted ? 'muted' : 'sound') + '</button>' +
    (active ? '' : '<button class="icon-btn" data-action="settings" aria-label="Open settings">' + icon('settings') + '</button>' +
    '<button class="icon-btn" data-action="wardrobe" aria-label="Open wardrobe">' + icon('shirt') + '</button>') + '</div>';
}
function friend(diving = false) {
  const atPrompt = !diving && view === 'play' && ['preview','answer','correction'].includes(session.phase);
  return '<button class="friend' + (diving ? ' dive-friend' : atPrompt ? ' at-prompt' : '') + '" data-action="blub" aria-label="a friend"><img' + goldSprite(save.character) + ' src="' +
    sprite(save.character) + '" alt=""></button>';
}
function landing() {
  const today = dayKey();
  const saved = getSaved();
  const canResume = validSession(saved) && saved.phase !== 'complete';
  const completed = mode === 'daily' && saved?.phase === 'complete';
  const label = completed ? 'VIEW YOUR DIVE' : canResume ? 'RESUME DESCENT' : 'BEGIN DESCENT';
  const title = mode === 'daily' ? 'THE DAILY DIVE' : 'THE ENDLESS DIVE';
  return '<main class="landing">' + controls() +
    '<header class="hero"><div class="wordmark" aria-label="Krillion TH">KRILLION</div><h1>' + title + '</h1>' +
    '<p>' + (mode === 'daily' ? '7 prompts · 25 seconds each · rarer answers sink deeper' : 'dive after dive · rarer answers sink deeper') + '</p></header>' +
    friend() + '<section class="landing-bottom">' +
    '<details class="howto"><summary>how to play</summary><ol>' +
    '<li>SEVEN PROMPTS. A SHARED DAILY CHALLENGE.</li><li>25 SECONDS. TYPE ONE ANSWER THAT FITS.</li>' +
    '<li>A LESS FAMILIAR ANSWER TAKES YOU DEEPER.</li><li>THE OBVIOUS OBSCURE PICK CAN BE TOO CLEVER.</li>' +
    '<li>ONE POINT = 10 METRES. AIM FOR 7,000M.</li><li>ONE DAILY ATTEMPT. ENDLESS DIVES ANYTIME.</li></ol></details>' +
    '<div class="landing-credits"><button class="small-link" data-action="about">About this dive</button><span>THAI KNOWLEDGE · WORLD CURIOSITY</span></div>' +
    (mode === 'daily' ? '<button class="discovery-card" data-action="endless"><span class="discovery-tag">DIVE AFTER DIVE</span><img src="' +
      sprite('schooler') + '" alt=""><span>ENDLESS DIVE</span><small>∞</small></button>' : '') +
    '<button class="begin" data-action="begin">▼ ' + label + ' ▼</button>' +
    '<div class="landing-nav"><span>' + (mode === 'daily' ? 'DIVE · ' + today : 'ENDLESS DIVE #' + (save.run + 1)) + '</span>' +
    '<div><button data-action="history">DIVE LOG ⟲</button><button data-action="' + (mode === 'daily' ? 'endless' : 'daily') + '">' +
    (mode === 'daily' ? 'UNLIMITED ∞' : 'TODAY’S DIVE') + '</button></div></div></section>' +
    '<div class="reference-footer">KRILLION TH · LOCAL EDITION</div></main>';
}
function hud() {
  const activeIndex = session.phase === 'reveal' ? Math.min(6, session.index + 1) : session.index;
  const pending = session.phase === 'sinking' ? session.results.at(-1) : null;
  const squares = Array.from({length:7}, (_, i) => {
    const result = pending && i === session.index ? null : session.results[i];
    const color = result ? result.tier ? tierColor(result.tier) : '#334453' : null;
    return '<i' + (i === activeIndex && !result ? ' class="current"' : '') + (color ? ' style="background:' + color + '"' : '') + '></i>';
  }).join('');
  return '<div class="hud"><div class="hud-badge"><small>DEPTH</small><strong data-live-depth>' + number(Math.round(scene.depth)) +
    'm</strong></div><div class="progress"><div class="progress-squares" aria-label="' + (session.results.length - (pending ? 1 : 0)) + ' of 7 answered">' + squares +
    '</div><small>PROMPT ' + (activeIndex + 1) + ' OF 7</small></div><div class="hud-badge score"><small>SCORE</small><strong>' +
    (session.score - (pending?.points || 0)) + '</strong></div></div>';
}
function promptCard() {
  const q = session.questions[session.index];
  return '<article class="prompt-card"><p class="eyebrow">PROMPT ' + (session.index + 1) + ' OF 7</p><h2>' + esc(q.prompt) +
    '</h2><p class="prompt-tag">▼ rarer answers sink deeper ▼</p><p class="category-hint">' + esc(q.hint) +
    '</p></article>';
}
function answerDock() {
  const correction = session.phase === 'correction' ? '<div class="correction" role="status"><p>Did you mean…</p><strong>' +
    esc(session.correction.label) + '</strong><div class="correction-actions"><button data-action="confirm">YES, DIVE ▼</button>' +
    '<button data-action="edit">KEEP TYPING ↵</button></div></div>' : '';
  return '<section class="answer-dock" aria-label="Answer this prompt">' +
    '<div class="timer-row"><span>MAKE IT COUNT.</span><span class="timer-number" id="timer" role="timer" aria-label="Seconds remaining">25</span></div>' +
    '<div class="timer-track" id="timer-track"><span id="timer-fill"></span></div>' + correction +
    (session.rejected ? '<div class="reject-text" role="status">ยังไม่พบคำตอบนี้ในคลัง ลองคำอื่นก่อนหมดเวลา</div>' : '') +
    '<form class="answer-form" id="answer-form"><input id="answer" name="answer" aria-label="Your answer" maxlength="256" placeholder="type one answer…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="' +
    esc(session.input || '') + '"' + (session.phase === 'correction' ? ' disabled' : '') + '><button class="dive-button" type="submit"' +
    (!session.input?.trim() || session.phase === 'correction' ? ' disabled' : '') + '>DIVE</button></form>' +
    '<div class="answer-meta"><span>ENTER ↵ TO DIVE</span><button data-action="skip">SKIP THIS PROMPT →</button></div></section>';
}
function revealView() {
  const result = session.results.at(-1), tier = result.tier ? TIERS[result.tier] : null;
  return '<section class="reveal" style="--result-color:' + (tier ? tierColor(result.tier) : '#92a5b8') + '">' +
    (tier ? '<img class="reveal-sprite" src="' + sprite(result.tier) + '" alt="">' : '<div class="reveal-sprite" style="margin:auto;font-size:70px">×</div>') +
    '<h2>' + (tier ? tier.name.toUpperCase() : result.reason === 'timeout' ? 'OUT OF TIME' : 'MISSED IT') + '</h2>' +
    '<p class="answer-label">' + (result.label ? '“' + esc(result.label) + '”' : 'ยังมีความรู้รออยู่ข้างล่าง') + '</p>' +
    '<p class="points"><strong>+' + result.points + ' PTS</strong> · sink ' + number(result.points * 10) + 'm</p>' +
    '<p class="blurb">' + (tier?.blurb || 'Take a breath. The next prompt awaits.') + '</p>' +
    '<button class="explanation-toggle" data-action="explain" data-index="' + session.index + '">เฉลยและที่มาของคำตอบ ↗</button></section>' +
    '<div class="next-dock"><button class="primary-button" data-action="next">' + (session.index === 6 ? 'SURFACE ▲' : 'DESCEND ▼') + '</button></div>';
}
function playing() {
  let content = '';
  const sinking = session.phase === 'sinking';
  const result = sinking ? session.results.at(-1) : null;
  if (session.phase === 'reveal') content = revealView();
  else if (sinking && result.points) {
    const startDepth = session.depth - result.points * METERS_PER_POINT;
    const bubbles = Array.from({length:18}, (_, i) =>
      '<i style="--x:' + ((i * 37 % 91) - 45) + 'px;--drift:' + ((i * 23 % 49) - 24) +
      'px;--delay:-' + (i * 173 % 1600) + 'ms;--size:' + (4 + i % 5) + 'px"></i>').join('');
    const sparks = result.tier === 'krillion' ? Array.from({length:12}, (_, i) =>
      '<i class="dive-spark" style="--x:' + ((i * 43 % 137) - 68) + 'px;--drift:' + ((i * 29 % 57) - 28) +
      'px;--delay:-' + (i * 193 % 1500) + 'ms;--size:' + (9 + i % 5) + 'px"></i>').join('') : '';
    content = promptCard() + '<div class="tier-lines" aria-hidden="true">' + TIER_ORDER.map(tier =>
      '<div class="tier-line" data-tier-depth="' + (startDepth + TIERS[tier].score * METERS_PER_POINT) +
      '" data-tier-score="' + TIERS[tier].score + '" style="--tier:' + tierColor(tier) + '"><span><img src="' +
      sprite(tier) + '" alt="">' + esc(TIERS[tier].name.toUpperCase()) + ' · ' + TIERS[tier].score + '</span></div>').join('') +
      '</div><div class="dive-rig' + (result.tier === 'krillion' ? ' is-gem' : '') + '" aria-live="polite">' +
      '<div class="dive-wake" aria-hidden="true">' + bubbles + sparks + '</div><div class="dive-ring" aria-hidden="true"></div>' +
      '<div class="sinking-answer">“' + esc(result.label || result.raw) + '” <span>▼</span></div>' + friend(true) + '</div>';
  } else if (sinking) {
    content = promptCard() + '<div class="miss-feedback">' + (result.reason === 'timeout' ? 'OUT OF TIME' : 'SKIPPED') + '</div>';
  } else {
    content = promptCard() + (session.phase === 'preview'
      ? '<div class="preview-status">descending · the clock starts in <strong id="preview-count">3</strong></div>'
      : answerDock());
  }
  return '<main class="playing' + (sinking ? ' is-sinking' : '') + '">' + controls(true) + hud() +
    (sinking && result.points ? '' : friend()) + content + '</main>';
}
function resultsView() {
  const gems = session.results.filter(r => r.tier === 'krillion').length;
  const title = session.score === 700 ? 'THE PERFECT DIVE' : session.score >= 450 ? 'INTO THE ABYSS' : session.score >= 250 ? 'A DEEPER KIND OF KNOWLEDGE' : 'BACK AT THE SURFACE';
  return '<main class="results-view">' + controls() +
    '<p class="overline">' + (session.mode === 'daily' ? 'DAILY DIVE · ' + session.date : 'ENDLESS DIVE #' + session.run) + '</p>' +
    '<h1>' + title + '</h1><div class="results-depth">' + number(session.depth) + '<span style="font-size:35px">m</span></div>' +
    '<p class="results-sub">' + session.score + ' / 700 POINTS · ' + gems + ' KRILLION' + (gems === 1 ? '' : 'S') + '</p>' +
    '<div class="results-graph" aria-label="Score for each of seven prompts">' + session.results.map((r, i) =>
      '<div class="graph-column" style="--tier:' + (r.tier ? tierColor(r.tier) : '#40526a') + '"><i style="height:' +
      r.points + '%"></i><span>' + (i + 1) + '</span></div>').join('') + '</div>' +
    '<div class="results-actions"><button class="primary-button" data-action="share">COPY RESULT ↗</button>' +
    '<button class="primary-button" data-action="new-endless">DIVE AGAIN ∞</button></div>' +
    '<div style="text-align:center"><button class="small-link" data-action="home">BACK TO THE SURFACE</button></div>' +
    '<section class="result-list" aria-label="Dive results">' + session.results.map((r, i) =>
      '<article class="result-row"><span class="num">' + (i + 1) + '</span><button data-action="explain" data-index="' + i +
      '"><div class="result-prompt">' + esc(r.prompt) + '</div><div class="result-answer">' + esc(r.label || (r.reason === 'timeout' ? 'หมดเวลา' : 'ข้ามข้อ')) +
      '</div></button><div class="result-score" style="color:' + (r.tier ? tierColor(r.tier) : '#7890a5') + '">' + r.points +
      '<div style="font-size:12px;letter-spacing:1px">' + (r.tier ? esc(TIERS[r.tier].name.toUpperCase()) : 'MISS') + '</div></div></article>').join('') +
    '</section><p class="results-footnote">ระดับคะแนนประเมินจากความคุ้นเคยและการตรวจทาน · ไม่ใช่เปอร์เซ็นต์ผู้ตอบ<br>บันทึกผลไว้ในเบราว์เซอร์นี้ · ' +
    esc(session.bankVersion) + '</p></main>';
}
function render(answerSelection = null) {
  document.title = 'Krillion TH · ' + (mode === 'daily' ? 'the daily dive' : 'the endless dive');
  app.innerHTML = view === 'home' ? landing() : view === 'play' ? playing() : resultsView();
  positionFriend();
  document.fonts.ready.then(positionFriend);
  syncScene();
  if (view === 'play' && session.phase === 'answer') {
    const answer = document.getElementById('answer');
    requestAnimationFrame(() => {
      if (modalKind || !answer?.isConnected || view !== 'play' || session?.phase !== 'answer') return;
      focusAnswer(answer, answerSelection);
    });
    wireInput();
  }
  updateTimer();
}
function syncScene() {
  const result = view === 'play' && session?.phase === 'sinking' ? session.results.at(-1) : null;
  if (result?.points) {
    const startedAt = Number.isFinite(result.answeredAt)
      ? result.answeredAt : session.phaseUntil - descentDuration(result.points);
    scene.setDescent(session.depth - result.points * METERS_PER_POINT, session.depth,
      startedAt, session.phaseUntil, save.settings.lowPower);
  } else scene.set(view === 'home' ? 0 : session?.depth || 0, view !== 'home', save.settings.lowPower);
}
function updateDescent(frame) {
  if (view !== 'play' || session?.phase !== 'sinking') return;
  const result = session.results.at(-1);
  if (!result?.points) return;
  const rig = document.querySelector('.dive-rig');
  if (rig) {
    rig.style.top = frame.objectY.toFixed(1) + 'px';
    rig.classList.toggle('is-landed', frame.landed);
  }
  let crossed = 0;
  document.querySelectorAll('.tier-line').forEach(line => {
    const threshold = Number(line.dataset.tierDepth);
    line.style.transform = 'translate3d(0,' + (frame.surface + threshold * PIXELS_PER_METER).toFixed(1) + 'px,0)';
    const passed = frame.depth + .05 >= threshold;
    line.classList.toggle('is-crossed', passed);
    if (passed && Number(line.dataset.tierScore) < result.points) crossed++;
  });
  if (lastTierLine === null) lastTierLine = crossed;
  else if (crossed > lastTierLine) { lastTierLine = crossed; audio.play('tierline'); }
  if (frame.landed && !landed) {
    landed = true;
    audio.play(result.points >= 60 ? 'land_big' : 'land_small');
  }
}
function positionFriend() {
  const target = document.querySelector('.friend.at-prompt'), card = document.querySelector('.prompt-card');
  if (!target || !card) return;
  const bounds = card.getBoundingClientRect();
  target.style.left = Math.min(innerWidth - 68, bounds.right - 42) + 'px';
  target.style.top = bounds.bottom - 56 + 'px';
}
addEventListener('resize',positionFriend);
function wireInput() {
  const input = document.getElementById('answer'), form = document.getElementById('answer-form');
  if (!input || !form) return;
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; rememberInput(input.value); });
  input.addEventListener('input', () => rememberInput(input.value));
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || composing)) event.preventDefault(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (composing) return;
    const previous = session, updated = submitAnswer(session, input.value, save.settings);
    if (updated === previous) return;
    if (updated.phase === 'sinking') audio.play('submit');
    else if (updated.phase === 'correction') audio.play('submit_soft');
    else if (updated.rejected) audio.play('reject');
    const selection = updated.phase === 'answer' && updated.rejected
      ? { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection }
      : null;
    transition(updated, selection);
  });
}
function rememberInput(value) {
  if (!session || session.phase !== 'answer') return;
  session.input = value;
  const button = document.querySelector('.dive-button');
  if (button) button.disabled = !value.trim();
  clearTimeout(inputSaveTimer);
  inputSaveTimer = setTimeout(persist, 180);
}
function transition(updated, answerSelection = null) {
  const previous = session;
  session = updated;
  if (session === previous) return;
  if (session.phase !== previous?.phase) {
    if (session.phase === 'answer' && previous?.phase === 'preview') audio.play('category');
    if (session.phase === 'sinking') {
      if (scene.reducedMotion) session = { ...session, phaseUntil: Math.min(session.phaseUntil, Date.now() + 120) };
      audio.play(session.results.at(-1).points ? 'sink' : 'miss');
      lastTick = -1; lastTierLine = 0; landed = false;
    }
    if (session.phase === 'reveal') {
      const tier = session.results.at(-1).tier;
      if (tier === 'krillion') audio.play('krillion');
      else if (!landed && session.results.at(-1).points) audio.play(session.results.at(-1).points >= 60 ? 'land_big' : 'land_small');
    }
    if (session.phase === 'complete') { view = 'results'; save.resumeSessionId=null; audio.play('surface'); }
  }
  persist(); render(answerSelection);
}
function pulse() {
  if (view === 'play' && session) {
    const updated = tickSession(session);
    if (updated !== session) transition(updated);
    updateTimer();
  }
}
function updateTimer() {
  if (view !== 'play' || !session) return;
  if (session.phase === 'preview') {
    const el = document.getElementById('preview-count');
    if (el) el.textContent = Math.max(1, Math.ceil((session.phaseUntil - Date.now()) / 1000));
  }
  if (['answer', 'correction'].includes(session.phase)) {
    const ms = Math.max(0, session.deadline - Date.now()), seconds = Math.ceil(ms / 1000);
    const timer = document.getElementById('timer'), track = document.getElementById('timer-track'), fill = document.getElementById('timer-fill');
    if (timer) { if (timer.textContent !== String(seconds)) timer.textContent = seconds; timer.classList.toggle('urgent', seconds <= 5); }
    track?.classList.toggle('urgent', seconds <= 5);
    if (fill) fill.style.width = ms / ANSWER_MS * 100 + '%';
    if (seconds > 0 && seconds <= 5 && lastTick !== seconds) { lastTick = seconds; audio.play('tick'); }
  }
}
function startDive(forceNew = false) {
  closeModal();
  save.resumeSessionId=null;
  if (!forceNew) {
    const saved = getSaved();
    if (validSession(saved) && (mode === 'daily' || saved.phase !== 'complete')) {
      session = tickSession(saved); view = session.phase === 'complete' ? 'results' : 'play'; persist(); render(); return;
    }
  }
  const date = dayKey();
  let questions;
  if (mode === 'daily') questions = selectDaily(bank, date);
  else {
    const selection = selectEndless(bank, save.seen);
    questions = selection.questions; save.seen = selection.seen; save.run++;
  }
  session = createSession({mode,bank,questions,date,run: mode === 'daily' ? 1 : save.run});
  view = 'play'; lastTick = -1; audio.play('begin'); persist(); render();
  window.scrollTo({top:0,behavior:'instant'});
}
function changeMode(nextMode) {
  save.resumeSessionId=null;
  if (session && view !== 'history-result') persist();
  else writeSave(save);
  mode = nextMode; closeModal();
  history.pushState({}, '', mode === 'daily' ? '/' : '/unlimited/classic');
  const saved = getSaved();
  session = validSession(saved) ? saved : null;
  view = 'home';
  render(); window.scrollTo({top:0,behavior:'instant'});
}
function toast(text) {
  const target = document.getElementById('toast');
  target.textContent = text; target.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => target.classList.remove('visible'), 3600);
}
function openModal(kind, title, content, drawer = false) {
  modalRestoreFocus = document.activeElement;
  modalKind = kind;
  modalRoot.innerHTML = '<div class="overlay' + (drawer ? ' drawer-overlay' : '') + '"><section class="dialog' +
    (drawer ? ' drawer' : '') + '" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="close-dialog" data-action="close" aria-label="Close ' +
    esc(title) + '">×</button>' + (drawer ? '<div class="brand-label">KRILLION TH</div>' : '') + '<h2 id="dialog-title">' +
    esc(title) + '</h2>' + content + '</section></div>';
  modalRoot.querySelector('.close-dialog').focus();
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  modalRoot.innerHTML = ''; modalKind = null; document.body.style.overflow = '';
  if (modalRestoreFocus?.isConnected) modalRestoreFocus.focus({preventScroll:true});
  else document.getElementById('answer')?.focus({preventScroll:true});
}
function settingsDialog() {
  const options = [
    ['lowPower','Low-power mode','Lighter graphics and fewer background animations.'],
    ['colorblind','Colorblind mode','Brighter text and more distinct tier colors.'],
    ['corrections','Answer corrections','Preview spelling corrections before scoring.'],
    ['clearRejected','Clear rejected entries','Empty the answer box after an unrecognized entry.'],
    ['shareLink','Share link','Include this game’s link under shared results.'],
    ['muted','Mute sound','Turn off the dive’s sound effects.']
  ];
  openModal('settings','Settings', options.map(([id,title,detail]) =>
    '<label class="settings-row"><span><strong>' + title + '</strong><small>' + detail +
    '</small></span><input class="toggle" type="checkbox" data-setting="' + id + '" aria-label="' + title + '"' +
    (save.settings[id] ? ' checked' : '') + '></label>').join('') +
    '<div class="dialog-footer"><button data-action="about">about & sources</button><button data-action="history">dive log</button></div>');
}
function menuDialog() {
  openModal('menu','Menu','<div class="nav-caption">DIVE IN</div><nav>' +
    '<button data-action="daily"' + (mode === 'daily' ? ' class="selected"' : '') + '>Daily dive</button>' +
    '<button data-action="endless"' + (mode === 'endless' ? ' class="selected"' : '') + '>∞ Unlimited</button>' +
    '<button data-action="history">⟲ Dive log</button><button data-action="wardrobe">Wardrobe</button>' +
    '<button data-action="settings">Settings</button><button data-action="about">About & sources</button></nav>' +
    '<div class="drawer-bottom">one in a krillion.<br><span style="font-size:13px;letter-spacing:1px">A THAI KNOWLEDGE DIVE.</span></div>', true);
}
function aboutDialog() {
  const articles = Object.values(evidence?.articles || {}), count = articles.filter(a => a.status === 'ok').length;
  const windowText = evidence?.window ? esc(evidence.window.start + ' — ' + evidence.window.end) : 'ยังไม่มีชุดข้อมูลยอดอ่าน';
  openModal('about','About this dive','<div class="body-copy"><p>เกมคำตอบหายากฉบับไทยที่สร้างตามประสบการณ์การเล่นของ ' +
    '<a href="https://krillion.io/" target="_blank" rel="noopener noreferrer">Krillion.io</a> สำหรับเล่นในเครื่อง</p>' +
    '<p>มี ' + bank.questions.length + ' โจทย์: เรื่องไทย ' + bank.questions.filter(q => q.scope === 'thai').length +
    ' ข้อ และความรู้ทั่วไป ' + bank.questions.filter(q => q.scope === 'world').length + ' ข้อ แต่ละรอบสุ่มไทย 5 ข้อกับทั่วไป 2 ข้อ</p>' +
    '<p><strong>คะแนนหมายถึงความคุ้นเคยที่ประเมินไว้</strong> ใช้ข้อมูลอ้างอิง ยอดอ่านบทความภาษาไทยเมื่อมีข้อมูล และการตรวจทานร่วมกัน ไม่ใช่เปอร์เซ็นต์คนไทยที่รู้คำตอบหรือจำนวนผู้เล่นที่ตอบคำนี้</p>' +
    '<p>คำตอบ 100 คะแนนคือคำตอบพิเศษที่คัดเลือกไว้ ไม่จำเป็นต้องเป็นคำที่มีคนอ่านน้อยที่สุด ส่วน Too Clever คือคำตอบที่ดูหายากแต่เป็นตัวเลือกที่มักนึกถึงกัน</p>' +
    '<p>อ่านแนวทางจาก <a href="https://krillion.io/faq" target="_blank" rel="noopener noreferrer">FAQ ของผู้สร้างต้นแบบ</a> และดูแหล่งอ้างอิงของแต่ละข้อหลังเฉลย</p>' +
    '<div class="method-info">คลัง ' + esc(bank.version) + ' · ตรวจเนื้อหา ' + esc(bank.reviewedAt) +
    '<br>ข้อมูลยอดอ่าน: ' + windowText + '<br>บทความที่มีข้อมูลครบ 12 เดือน: ' + count +
    ' รายการ<br>ปฏิทินด่าน: America/New_York ตามต้นแบบ · ความคืบหน้าบันทึกในเบราว์เซอร์นี้</div>' +
    '<p style="font-size:11px;color:#7c9bb6">ภาพฉากและตัวละครสร้างใหม่สำหรับโปรเจกต์นี้ ที่มาและสิทธิ์ของฟอนต์อยู่ใน assets/README.md เกมนี้เป็นโปรเจกต์แยกจาก Krillion.io</p></div>');
}
function wardrobeDialog() {
  const completed = save.history.length, gems = save.history.reduce((n,s) => n + s.results.filter(r => r.tier === 'krillion').length, 0);
  const characters = [
    ['krillion','a little friend',true,'your first dive buddy'],
    ['schooler','schooler',completed >= 1,'finish one dive'],
    ['rare','rare companion',completed >= 3,'finish three dives'],
    ['deepcut','deep cut',completed >= 7,'finish seven dives'],
    ['krillion-gold','golden buddy',gems >= 1,'find one Krillion'],
    ['schooler-gold','golden schooler',gems >= 3,'find three Krillions']
  ];
  openModal('wardrobe','Your dive buddy','<div class="wardrobe-grid">' + characters.map(([id,title,unlocked,detail]) =>
    '<button class="wardrobe-item' + (save.character === id ? ' selected' : '') + '" data-character="' + id + '"' +
    (!unlocked ? ' disabled' : '') + '><img' + goldSprite(id) + ' src="' + sprite(id) + '" alt=""><span>' + title + '</span><small>' +
    (unlocked ? save.character === id ? 'EQUIPPED' : 'SELECT' : '🔒 ' + detail) + '</small></button>').join('') +
    '</div><p class="method-info">ตัวละครปลดล็อกจากประวัติการเล่นในเครื่องนี้</p>');
}
function historyDialog() {
  const best = Math.max(0, ...save.history.map(s=>s.score)), gems = save.history.reduce((n,s)=>n+s.results.filter(r=>r.tier==='krillion').length,0);
  const unfinished=savedSessions(save).filter(s=>s.phase!=='complete').sort((a,b)=>b.startedAt-a.startedAt);
  openModal('history','Dive log','<div class="history-stats"><div><strong>' + save.history.length +
    '</strong><small>DIVES</small></div><div><strong>' + best + '</strong><small>BEST SCORE</small></div><div><strong>' +
    gems + '</strong><small>KRILLIONS</small></div></div>' +
    (unfinished.length ? '<p class="nav-caption">DIVES IN PROGRESS</p>'+unfinished.map(s=>
      '<button class="history-item" data-resume="'+esc(s.id)+'"><span>'+(s.mode==='daily'?'Daily · '+esc(s.date):'Endless #'+s.run)+
      '<small>เล่นต่อ · ข้อ '+(s.index+1)+'/7'+(s.bankVersion!==bank.version?' · ชุดก่อนหน้า':'')+
      '</small></span><strong>RESUME →</strong></button>').join(''):'') +
    (save.history.length ? save.history.map((s,i) =>
    '<button class="history-item" data-history="' + i + '"><span>' + (s.mode === 'daily' ? 'Daily · ' + esc(s.date) : 'Endless #' + s.run) +
    '<small>' + s.results.map(r => r.tier ? TIERS[r.tier].emoji : '⬛').join('') + '</small></span><strong>' +
    number(s.depth) + 'm</strong></button>').join('') : '<p class="empty-history">ยังไม่มีประวัติการดำน้ำ<br>เล่นให้ครบ 7 ข้อ แล้วกลับมาดูผลงานได้ที่นี่</p>'));
}
function explainDialog(index) {
  const q = session?.questions[index], result = session?.results[index];
  if (!q || !result) return;
  const answer = q.answers.find(a=>a.id===result.answerId);
  const item = answer?.wikiTitle ? evidence?.articles?.[answer.wikiTitle] : null;
  const metric = item?.status === 'ok'
    ? '<div class="method-info">บทความ: ' + esc(answer.wikiTitle) + '<br>ยอดอ่านรวม 12 เดือน: ' +
      number(item.totalViews) + ' ครั้ง<br>ค่ามัธยฐานรายเดือน: ' + number(item.medianMonthlyViews) +
      ' ครั้ง<br>ช่วงข้อมูล: ' + esc(evidence.window.start + ' — ' + evidence.window.end) +
      '<br><a href="' + safeUrl(item.url) + '" target="_blank" rel="noopener noreferrer">ดูข้อมูลต้นทาง ↗</a></div>' : '';
  openModal('explain','Field notes · ' + (index+1),'<div class="body-copy"><p><strong>' + esc(q.prompt) + '</strong></p><p>' +
    esc(q.explanation) + '</p>' + (answer ? '<p>คำตอบของคุณ: <strong>' + esc(answer.label) + '</strong></p><p>' +
    esc(answer.reason) + '</p>' + metric : '') +
    '<details class="evidence-details"><summary>แหล่งอ้างอิงของโจทย์</summary><ul>' + q.sources.map(s =>
      '<li><a href="' + safeUrl(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + '</a></li>').join('') + '</ul></details>' +
    '<div class="method-info">' + (metric
      ? 'ยอดอ่านเป็นข้อมูลความสนใจต่อบทความ ไม่ใช่สัดส่วนผู้เล่นที่เลือกคำตอบ คะแนนเป็นการประเมินของผู้จัดทำ'
      : 'คำตอบนี้ยังไม่มีข้อมูลยอดอ่านที่ผูกไว้ คะแนนเป็นการประเมินของผู้จัดทำ ไม่ใช่สถิติผู้เล่น') + '</div>' +
    '<details class="evidence-details"><summary>ดูคำตอบที่ยอมรับทั้งหมด (' + q.answers.length + ')</summary><div class="answer-bank">' +
    [...q.answers].sort((a,b)=>TIERS[b.tier].score-TIERS[a.tier].score).map(a => '<div class="bank-row"><span>' + esc(a.label) +
    '</span><small style="--tier:' + tierColor(a.tier) + '">' + TIERS[a.tier].name + ' · ' + TIERS[a.tier].score + '</small></div>').join('') +
    '</div></details></div>');
}
async function copyResult() {
  const text = shareText(session,save.settings.shareLink,location.origin);
  try { await navigator.clipboard.writeText(text); toast('คัดลอกผลการดำน้ำแล้ว'); audio.play('spare'); }
  catch { openModal('share','Share your dive','<pre class="share-text">' + esc(text) + '</pre><p class="body-copy">เลือกข้อความแล้วคัดลอกเพื่อแชร์ผลได้เลย</p>'); }
}
document.addEventListener('click', async event => {
  const character = event.target.closest('[data-character]');
  if (character && !character.disabled) {
    save.character = character.dataset.character; persist(); render(); wardrobeDialog(); audio.play('blub'); return;
  }
  const historyItem = event.target.closest('[data-history]');
  if (historyItem) {
    session = structuredClone(save.history[Number(historyItem.dataset.history)]);
    closeModal(); view = 'history-result'; render(); window.scrollTo({top:0,behavior:'instant'}); return;
  }
  const resumeItem=event.target.closest('[data-resume]');
  if(resumeItem) {
    const old=savedSessions(save).find(s=>s.id===resumeItem.dataset.resume);
    if(!old)return;
    session=tickSession(structuredClone(old));mode=session.mode;view='play';save.resumeSessionId=session.id;
    history.pushState({},'',mode==='daily'?'/':'/unlimited/classic');
    closeModal();persist();render();window.scrollTo({top:0,behavior:'instant'});return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) { if (event.target.classList.contains('overlay')) closeModal(); return; }
  const action = button.dataset.action;
  await audio?.unlock();
  switch (action) {
    case 'menu': menuDialog(); break;
    case 'settings': settingsDialog(); break;
    case 'about': aboutDialog(); break;
    case 'wardrobe': wardrobeDialog(); break;
    case 'history': historyDialog(); break;
    case 'close': closeModal(); break;
    case 'daily': changeMode('daily'); break;
    case 'endless': changeMode('endless'); break;
    case 'home': closeModal(); save.resumeSessionId=null;persist();view = 'home'; session = null; render(); window.scrollTo({top:0,behavior:'instant'}); break;
    case 'begin': startDive(); break;
    case 'new-endless': changeMode('endless'); startDive(true); break;
    case 'next': audio.play(session.index === 6 ? 'surface' : 'descend'); transition(nextRound(session)); break;
    case 'skip': transition(skipRound(session)); break;
    case 'confirm': transition(confirmCorrection(session)); break;
    case 'edit': if (session.phase === 'correction') transition({...session,phase:'answer',correction:null}); break;
    case 'share': await copyResult(); break;
    case 'explain': explainDialog(Number(button.dataset.index)); break;
    case 'sound':
      save.settings.muted = !save.settings.muted; applySettings(); persist(); render();
      if (!save.settings.muted) audio.play('blub'); break;
    case 'blub':
      audio.play('blub'); button.classList.add('blub'); setTimeout(()=>button.classList.remove('blub'),1000); break;
  }
});
modalRoot.addEventListener('change',event => {
  const key = event.target.dataset.setting;
  if (!key) return;
  save.settings[key] = event.target.checked; applySettings(); persist();
  // Keep the dialog and its keyboard focus intact while updating the scene.
  syncScene();
});
document.addEventListener('keydown',event => {
  if (!modalKind) return;
  if (event.key === 'Escape') { closeModal(); event.preventDefault(); }
  if (event.key === 'Tab') {
    const nodes = [...modalRoot.querySelectorAll('button:not(:disabled),a[href],input,summary')].filter(el=>el.getClientRects().length);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
addEventListener('popstate',()=>{mode=location.pathname.startsWith('/unlimited')?'endless':'daily';closeModal();restoreCurrent();render();});
addEventListener('pagehide',()=>{clearTimeout(inputSaveTimer);persist();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pulse();});
load();
