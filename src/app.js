import { ANSWER_MS, PREVIEW_MS, TIME_ZONE, TIERS, TIER_ORDER, dayKey, selectDaily, selectEndless,
  createSession, tickSession, submitAnswer, confirmCorrection, skipRound, nextRound, shareText } from './game.js';
import { readSave, writeSave, emptySave, ensureClientId, validSession, dailySlot, prepareSaveForBank, currentSavedSession, savedSessions } from './storage.js';
import { curatedReason, isSurveySession, prepareSurveyBank, starterExample, surveyTiers, surveyValue } from './survey.js';
import { answerForms } from './answers.js';
import { DiveAudio } from './audio.js';
import { OceanScene } from './scene.js';
import { descentDuration, PIXELS_PER_METER, METERS_PER_POINT } from './descent.js';
import { focusAnswer } from './input.js';

const APP_VERSION = '1.0.8';
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
let bank, audio, scene;
let save = emptySave(), mode = location.pathname.startsWith('/unlimited') ? 'endless' : 'daily';
let session = null, view = 'home', composing = false, lastTick = -1, lastTierLine = null, landed = false, inputSaveTimer, toastTimer;
let modalRestoreFocus = null, modalKind = null;
let depthDisplay = null, displayedDepth = null, descentView = null;
const openExamples = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const number = n => Number(n).toLocaleString('en-US');
const surveySession = value => validSession(value) && isSurveySession(value);
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
      fetch('/data/survey-bank.json?v=' + APP_VERSION, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error('คลังผลสำรวจโหลดไม่สำเร็จ'); return r.json(); }),
      fetch('/assets/audio-cues.json?v=' + APP_VERSION).then(r => { if (!r.ok) throw new Error('ชุดเสียงโหลดไม่สำเร็จ'); return r.json(); })
    ]);
    if (results[0].status !== 'fulfilled') throw results[0].reason;
    if (results[1].status !== 'fulfilled') throw results[1].reason;
    bank = prepareSurveyBank(results[0].value);
    save = prepareSaveForBank(readSave(globalThis.localStorage, bank), bank);
    ensureClientId(save);
    writeSave(save, globalThis.localStorage, bank);
    audio = new DiveAudio(results[1].value, save.settings.muted);
    scene = new OceanScene((depth, frame) => {
      if (depthDisplay && displayedDepth !== depth) {
        depthDisplay.textContent = number(depth) + 'm';
        displayedDepth = depth;
      }
      if (frame && descentView && view === 'play' && session?.phase === 'sinking') {
        updateDescent(frame);
        if (frame.finished) transition(tickSession(session));
      }
    });
    applySettings();
    restoreCurrent();
    render();
    if (view !== 'play' && save.seenPatchVersion !== APP_VERSION) patchNotesDialog();
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
  const candidate = currentSavedSession(save,mode,dayKey(),bank.version);
  return surveySession(candidate) ? candidate : null;
}
function restoreCurrent() {
  const requested=savedSessions(save).find(s=>s.id===save.resumeSessionId&&s.phase!=='complete'&&surveySession(s));
  const saved = requested?.mode===mode ? requested : getSaved();
  session = surveySession(saved) ? saved : null;
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
  if (!bank) return;
  if (session && view !== 'history-result') {
    if (session.mode === 'daily') save.daily[dailySlot(session.date,session.bankVersion)] = session;
    else {
      save.endlessByBank[session.bankVersion]=session;
      if(session.bankVersion===bank.version)save.endless=session;
    }
    if (session.phase === 'complete' && !save.history.some(item => item.id === session.id)) {
      save.history.unshift(structuredClone(session));
      let surveyCount = 0;
      save.history = save.history.filter(item => !surveySession(item) || ++surveyCount <= 40);
    }
    if (session.phase === 'complete') sendTelemetryIfNeeded(session);
  }
  for (const [date, stored] of Object.entries(save.daily)) {
    if (surveySession(stored) && stored?.date !== dayKey() && stored?.phase === 'complete' && save.history.some(item => item.id === stored.id))
      delete save.daily[date];
  }
  const dates = Object.keys(save.daily).filter(key => surveySession(save.daily[key])).sort();
  for (const date of dates.slice(0, Math.max(0, dates.length - 35))) delete save.daily[date];
  if (!writeSave(save, globalThis.localStorage, bank)) toast('บันทึกในเบราว์เซอร์ไม่ได้ กรุณาตรวจพื้นที่จัดเก็บหรือโหมดส่วนตัว');
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
    '<li>LOWER OR RARER RANKS CAN SINK DEEPER.</li><li>ONLY ANSWERS IN THIS DIVE’S BANK CAN SCORE.</li>' +
    '<li>ONE POINT = 10 METRES. AIM FOR 7,000M.</li><li>ONE DAILY ATTEMPT. ENDLESS DIVES ANYTIME.</li></ol></details>' +
    '<div class="landing-credits"><button class="small-link" data-action="about">About this dive</button>' +
    '<button class="landing-patch-btn" data-action="patchnotes">✦ Patch Notes · v' + APP_VERSION + '</button></div>' +
    (mode === 'daily' ? '<button class="discovery-card" data-action="endless"><span class="discovery-tag">DIVE AFTER DIVE</span><img src="' +
      sprite('schooler') + '" alt=""><span>ENDLESS DIVE</span><small>∞</small></button>' : '') +
    '<button class="begin" data-action="begin">▼ ' + label + ' ▼</button>' +
    '<div class="landing-nav"><span>' + (mode === 'daily' ? 'DIVE · ' + today : 'ENDLESS DIVE #' + (canResume ? saved.run : save.run + 1)) + '</span>' +
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
  const example = starterExample(q);
  const exampleKey = session.id + ':' + session.index;
  const exampleHint = ['preview','answer','correction'].includes(session.phase)
    ? '<details class="starter-hint" data-example-key="' + esc(exampleKey) + '"' + (openExamples.has(exampleKey) ? ' open' : '') +
      '><summary>ขอตัวอย่างคำตอบ</summary><span>เช่น ' + esc(example.label) + '</span></details>' : '';
  return '<article class="prompt-card"><p class="eyebrow">PROMPT ' + (session.index + 1) + ' OF 7</p><h2>' + esc(q.prompt) +
    '</h2><p class="prompt-tag">▼ rarer answers sink deeper ▼</p><p class="category-hint">' + esc(q.hint) +
    '</p>' + exampleHint + '</article>';
}
function answerDock() {
  const correction = session.phase === 'correction' ? '<div class="correction" role="status"><p>Did you mean…</p><strong>' +
    esc(session.correction.label) + '</strong><div class="correction-actions"><button data-action="confirm">YES, DIVE ▼</button>' +
    '<button data-action="edit">KEEP TYPING ↵</button></div></div>' : '';
  return '<section class="answer-dock" aria-label="Answer this prompt">' +
    '<div class="timer-row"><span>MAKE IT COUNT.</span><span class="timer-number" id="timer" role="timer" aria-label="Seconds remaining">25</span></div>' +
    '<div class="timer-track" id="timer-track"><span id="timer-fill"></span></div>' + correction +
    (session.rejected ? '<div class="reject-text" role="status">คำนี้ยังไม่มีข้อมูลในคลัง ลองตอบชื่ออื่นได้ก่อนหมดเวลา</div>' : '') +
    '<form class="answer-form" id="answer-form"><input id="answer" name="answer" aria-label="Your answer" maxlength="256" placeholder="type one answer…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" value="' +
    esc(session.input || '') + '"' + (session.phase === 'correction' ? ' disabled' : '') + '><button class="dive-button" type="submit"' +
    (!session.input?.trim() || session.phase === 'correction' ? ' disabled' : '') + '>DIVE</button></form>' +
    '<div class="answer-meta"><span>ENTER ↵ TO DIVE</span><button data-action="skip">SKIP THIS PROMPT →</button></div></section>';
}
function revealView(arriving = false) {
  const result = session.results.at(-1), tier = result.tier ? TIERS[result.tier] : null;
  const revealClass = arriving ? ' is-arriving' : tier ? '' : ' is-miss';
  return '<section class="reveal' + revealClass + '"' + (arriving ? ' inert aria-hidden="true"' : '') +
    ' style="--result-color:' + (tier ? tierColor(result.tier) : '#92a5b8') + '">' +
    (tier ? '<img class="reveal-sprite" src="' + sprite(result.tier) + '" alt="">' : '<div class="reveal-sprite" style="margin:auto;font-size:70px">×</div>') +
    '<h2>' + (tier ? tier.name.toUpperCase() : result.reason === 'timeout' ? 'OUT OF TIME' : 'MISSED IT') + '</h2>' +
    '<p class="answer-label">' + (result.label ? '“' + esc(result.label) + '”' : 'ยังมีความรู้รออยู่ข้างล่าง') + '</p>' +
    '<p class="points"><strong>+' + result.points + ' PTS</strong> · sink ' + number(result.points * 10) + 'm</p>' +
    '<p class="blurb">' + (tier?.blurb || 'Take a breath. The next prompt awaits.') + '</p>' +
    '<button class="explanation-toggle" data-action="explain" data-index="' + session.index + '">เฉลยและที่มาของคำตอบ ↗</button></section>' +
    (arriving ? '' : '<div class="next-dock"><button class="primary-button" data-action="next">' +
      (session.index === 6 ? 'SURFACE ▲' : 'DESCEND ▼') + '</button></div>');
}
function playing() {
  let content = '';
  const sinking = session.phase === 'sinking';
  const result = sinking ? session.results.at(-1) : null;
  const scoredReveal = session.phase === 'reveal' && session.results.at(-1)?.points;
  if (session.phase === 'reveal') content = revealView();
  else if (sinking && result.points) {
    const startDepth = session.depth - result.points * METERS_PER_POINT;
    const bubbles = Array.from({length:12}, (_, i) =>
      '<i style="--x:' + ((i * 37 % 91) - 45) + 'px;--drift:' + ((i * 23 % 49) - 24) +
      'px;--delay:-' + (i * 173 % 1600) + 'ms;--size:' + (4 + i % 5) + 'px"></i>').join('');
    const sparks = result.tier === 'krillion' ? Array.from({length:6}, (_, i) =>
      '<i class="dive-spark" style="--x:' + ((i * 43 % 137) - 68) + 'px;--drift:' + ((i * 29 % 57) - 28) +
      'px;--delay:-' + (i * 193 % 1500) + 'ms;--size:' + (9 + i % 5) + 'px"></i>').join('') : '';
    content = promptCard() + '<div class="tier-lines" aria-hidden="true"><div class="tier-track" data-start-depth="' +
      startDepth + '">' + TIER_ORDER.map(tier =>
      '<div class="tier-line" data-tier-score="' + TIERS[tier].score + '" style="--tier:' + tierColor(tier) +
      ';top:' + TIERS[tier].score * METERS_PER_POINT * PIXELS_PER_METER + 'px"><span><img src="' +
      sprite(tier) + '" alt="">' + esc(TIERS[tier].name.toUpperCase()) + ' · ' + TIERS[tier].score + '</span></div>').join('') +
      '</div></div><div class="dive-rig' + (result.tier === 'krillion' ? ' is-gem' : '') + '" aria-live="polite">' +
      '<div class="dive-wake" aria-hidden="true">' + bubbles + sparks + '</div><div class="dive-ring" aria-hidden="true"></div>' +
      '<div class="sinking-answer">“' + esc(result.label || result.raw) + '” <span>▼</span></div>' + friend(true) + '</div>' + revealView(true);
  } else if (sinking) {
    content = promptCard() + '<div class="miss-feedback">' + (result.reason === 'timeout' ? 'OUT OF TIME' : 'SKIPPED') + '</div>';
  } else {
    content = promptCard() + (session.phase === 'preview'
      ? '<div class="preview-status">descending · the clock starts in <strong id="preview-count">3</strong></div>'
      : answerDock());
  }
  return '<main class="playing' + (sinking ? ' is-sinking' : '') + '">' + controls(true) + hud() +
    ((sinking && result.points) || scoredReveal ? '' : friend()) + content + '</main>';
}
function resultsView() {
  const gems = session.results.filter(r => r.tier === 'krillion').length;
  const title = session.score === 700 ? 'THE PERFECT DIVE' : session.score >= 450 ? 'INTO THE ABYSS' : session.score >= 250 ? 'A DEEPER KIND OF KNOWLEDGE' : 'BACK AT THE SURFACE';
  const totalRejected = session.results.reduce((sum, r) => sum + (Array.isArray(r.rejectedInputs) ? r.rejectedInputs.length : 0), 0);
  return '<main class="results-view">' + controls() +
    '<p class="overline">' + (session.mode === 'daily' ? 'DAILY DIVE · ' + session.date : 'ENDLESS DIVE #' + session.run) + '</p>' +
    '<h1>' + title + '</h1><div class="results-depth">' + number(session.depth) + '<span style="font-size:35px">m</span></div>' +
    '<p class="results-sub">' + session.score + ' / 700 POINTS · ' + gems + ' KRILLION' + (gems === 1 ? '' : 'S') + '</p>' +
    '<div class="results-graph" aria-label="Score for each of seven prompts">' + session.results.map((r, i) =>
      '<div class="graph-column" style="--tier:' + (r.tier ? tierColor(r.tier) : '#40526a') + '"><i style="height:' +
      r.points + '%"></i><span>' + (i + 1) + '</span></div>').join('') + '</div>' +
    '<div class="results-actions"><button class="primary-button" data-action="share">COPY RESULT ↗</button>' +
    '<button class="primary-button" data-action="new-endless">DIVE AGAIN ∞</button></div>' +
    '<div class="survey-cta-wrap"><button class="survey-trigger" data-action="survey">+ เสนอคำตอบที่ควรมีเพิ่มในคลัง (SURVEY)' +
    (totalRejected ? '<span class="survey-badge">' + totalRejected + ' MISSED</span>' : '') + '</button></div>' +
    '<div style="text-align:center"><button class="small-link" data-action="home">BACK TO THE SURFACE</button></div>' +
    '<section class="result-list" aria-label="Dive results">' + session.results.map((r, i) =>
      '<article class="result-row"><span class="num">' + (i + 1) + '</span><button data-action="explain" data-index="' + i +
      '"><div class="result-prompt">' + esc(r.prompt) + '</div><div class="result-answer">' + esc(r.label || (r.reason === 'timeout' ? 'หมดเวลา' : 'ข้ามข้อ')) +
      '</div></button><div class="result-score" style="color:' + (r.tier ? tierColor(r.tier) : '#7890a5') + '">' + r.points +
      '<div style="font-size:12px;letter-spacing:1px">' + (r.tier ? esc(TIERS[r.tier].name.toUpperCase()) : 'MISS') + '</div></div></article>').join('') +
    '</section><p class="results-footnote">แต้มมาจากผลสำรวจหรือระดับความคุ้นเคยของคลังคำตอบในแต่ละข้อ · ไม่ใช่สัดส่วนผู้เล่น<br>บันทึกผลไว้ในเบราว์เซอร์นี้ · ' +
    esc(session.bankVersion) + '</p></main>';
}
function render(answerSelection = null) {
  document.title = 'Krillion TH · ' + (mode === 'daily' ? 'the daily dive' : 'the endless dive');
  app.innerHTML = view === 'home' ? landing() : view === 'play' ? playing() : resultsView();
  depthDisplay = app.querySelector('[data-live-depth]');
  displayedDepth = null;
  const rig = app.querySelector('.dive-rig');
  const track = app.querySelector('.tier-track');
  descentView = rig && {
    rig, reveal: app.querySelector('.reveal.is-arriving'), track,
    startDepth: Number(track.dataset.startDepth),
    tiers: [...track.children].map(line => ({ line, score: Number(line.dataset.tierScore) }))
  };
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
  const result = session.results.at(-1);
  const { rig, reveal, track, startDepth, tiers } = descentView;
  const diveOpacity = frame.visibility * (1 - frame.handoff);
  rig.style.transform = 'translate3d(-50%,calc(' + frame.objectY.toFixed(2) + 'px - 50%),0)';
  rig.style.opacity = diveOpacity;
  rig.classList.toggle('is-landed', frame.landed);
  track.style.transform = 'translate3d(0,' + (frame.surface + startDepth * PIXELS_PER_METER).toFixed(2) + 'px,0)';
  track.style.opacity = diveOpacity;
  reveal.style.opacity = frame.handoff;
  let crossed = 0;
  for (const {line, score} of tiers) {
    const passed = frame.depth + .05 >= startDepth + score * METERS_PER_POINT;
    line.classList.toggle('is-crossed', passed);
    if (passed && score < result.points) crossed++;
  }
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
document.addEventListener('toggle', event => {
  const details = event.target;
  if (!details.matches?.('details[data-example-key]')) return;
  if (details.open) openExamples.add(details.dataset.exampleKey);
  else openExamples.delete(details.dataset.exampleKey);
}, true);
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
    if (descentView && session.phase === 'sinking' && !document.hidden) return;
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
    if (surveySession(saved) && (mode === 'daily' || saved.phase !== 'complete')) {
      session = tickSession(saved); view = session.phase === 'complete' ? 'results' : 'play'; persist(); render(); return;
    }
  }
  const date = dayKey();
  let questions;
  if (mode === 'daily') questions = selectDaily(bank, date);
  else {
    const selection = selectEndless(bank, save.seen, Math.random, save.run + 1);
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
  session = surveySession(saved) ? saved : null;
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
  modalRoot.innerHTML = '<div class="overlay' + (drawer ? ' drawer-overlay' : '') + '"><section class="dialog dialog-' + esc(kind) +
    (drawer ? ' drawer' : '') + '" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="close-dialog" data-action="close" aria-label="Close ' +
    esc(title) + '">×</button>' + (drawer ? '<div class="brand-label">KRILLION TH</div>' : '') + '<h2 id="dialog-title">' +
    esc(title) + '</h2>' + content + '</section></div>';
  modalRoot.querySelector('.close-dialog').focus();
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  if (modalKind === 'patchnotes' && save.seenPatchVersion !== APP_VERSION) {
    save.seenPatchVersion = APP_VERSION;
    persist();
  }
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
    '<button data-action="patchnotes">✦ Patch Notes <span>v' + APP_VERSION + '</span></button>' +
    '<button data-action="settings">Settings</button><button data-action="about">About & sources</button></nav>' +
    '<div class="drawer-bottom">one in a krillion.<br><span style="font-size:13px;letter-spacing:1px">A THAI KNOWLEDGE DIVE.</span></div>', true);
}
function aboutDialog() {
  openModal('about','About this dive','<div class="body-copy"><p>เกมคำตอบหายากฉบับไทยที่สร้างตามประสบการณ์การเล่นของ ' +
    '<a href="https://krillion.io/" target="_blank" rel="noopener noreferrer">Krillion.io</a> สำหรับเล่นผ่านเบราว์เซอร์</p>' +
    '<p>มี ' + bank.questions.length + ' คำถาม: เรื่องไทย ' + bank.questions.filter(q => q.scope === 'thai').length +
    ' ข้อ และเรื่องทั่วไป ' + bank.questions.filter(q => q.scope === 'world').length +
    ' ข้อ แต่ละรอบมี 7 ข้อ สลับสัดส่วนไทยกับทั่วไปเป็น 4:3 และ 3:4</p>' +
    '<p>นึกไม่ออกใช่ไหม? กดขอตัวอย่างคำตอบบนการ์ดได้หนึ่งคำตอบ</p>' +
    '<p><strong>ระบบคะแนนแบบผสม (Survey + Curated)</strong> บางโจทย์เรียงแต้มจากผลสำรวจที่เผยแพร่จริง และบางโจทย์ใช้คลังคัดสรรตามความคุ้นเคยเพื่อขยายหมวดชีวิตประจำวันและคำตอบให้ครอบคลุมขึ้น ดูที่มาและเกณฑ์ของแต่ละข้อได้ในหน้าเฉลย</p>' +
    '<p>เกมให้แต้มเฉพาะคำตอบที่อยู่ในคลังของข้อนั้น คำที่ยังไม่มีในคลังอาจยังสมเหตุผลตามโจทย์ได้ ดูที่มา ขอบเขต และรายการคำตอบทั้งหมดหลังเฉลย</p>' +
    '<div class="method-info">คลัง ' + esc(bank.version) +
    '<br>ปฏิทินด่าน: America/New_York ตามต้นแบบ · ความคืบหน้าบันทึกในเบราว์เซอร์นี้</div>' +
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
  const history=save.history.map((s,i)=>({s,i})).filter(item=>surveySession(item.s));
  const legacyCount=save.history.length-history.length;
  const best = Math.max(0, ...history.map(({s})=>s.score)), gems = history.reduce((n,{s})=>n+s.results.filter(r=>r.tier==='krillion').length,0);
  const unfinished=savedSessions(save).filter(s=>s.phase!=='complete'&&surveySession(s)).sort((a,b)=>b.startedAt-a.startedAt);
  openModal('history','Dive log','<div class="history-stats"><div><strong>' + history.length +
    '</strong><small>DIVES</small></div><div><strong>' + best + '</strong><small>BEST SCORE</small></div><div><strong>' +
    gems + '</strong><small>KRILLIONS</small></div></div>' +
    (unfinished.length ? '<p class="nav-caption">DIVES IN PROGRESS</p>'+unfinished.map(s=>
      '<button class="history-item" data-resume="'+esc(s.id)+'"><span>'+(s.mode==='daily'?'Daily · '+esc(s.date):'Endless #'+s.run)+
      '<small>เล่นต่อ · ข้อ '+(s.index+1)+'/7'+(s.bankVersion!==bank.version?' · ชุดก่อนหน้า':'')+
      '</small></span><strong>RESUME →</strong></button>').join(''):'') +
    (history.length ? history.map(({s,i}) =>
    '<button class="history-item" data-history="' + i + '"><span>' + (s.mode === 'daily' ? 'Daily · ' + esc(s.date) : 'Endless #' + s.run) +
    '<small>' + s.results.map(r => r.tier ? TIERS[r.tier].emoji : '⬛').join('') + '</small></span><strong>' +
    number(s.depth) + 'm</strong></button>').join('') : '<p class="empty-history">ยังไม่มีประวัติการดำน้ำ<br>เล่นให้ครบ 7 ข้อ แล้วกลับมาดูผลงานได้ที่นี่</p>') +
    (legacyCount ? '<p class="method-info">ประวัติรุ่นก่อน ' + legacyCount + ' รอบยังเก็บไว้ในเครื่อง แต่คะแนนรุ่นนั้นไม่ได้ใช้ผลสำรวจจึงไม่แสดงรวม</p>' : ''));
}
const EVIDENCE_PAGE_SIZE = 100;
const evidenceNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const evidenceValue = (q, a, tier) => q.curated
  ? TIERS[tier].name
  : evidenceNumber.format(surveyValue(q, a)) + (q.survey.scale === 'rating-1-to-7' ? ' / 7' : '%');
function wireEvidenceList(q, tiers) {
  const details = modalRoot.querySelector('.evidence-details');
  const filter = details.querySelector('input'), rows = details.querySelector('.answer-bank');
  const status = details.querySelector('.evidence-status'), more = details.querySelector('.evidence-more');
  const ordered = q.curated
    ? [...q.answers].sort((a,b)=>TIERS[tiers.get(a.id)].score-TIERS[tiers.get(b.id)].score || a.label.localeCompare(b.label,'th'))
    : [...q.answers].sort((a,b)=>surveyValue(q,b)-surveyValue(q,a));
  let shown = EVIDENCE_PAGE_SIZE;
  const names = ordered.map(a => [a.label, ...a.aliases].flatMap(answerForms));
  function draw() {
    const terms = answerForms(filter.value).filter(Boolean);
    const matches = terms.length ? ordered.filter((_, i) => terms.some(t=>names[i].some(n=>n.includes(t)))) : ordered;
    rows.innerHTML = matches.slice(0,shown).map(a => {
      const tier=tiers.get(a.id);
      return '<div class="bank-row"><span>' + esc(a.label) + '</span><small style="--tier:' + tierColor(tier) +
        '"> ' + esc(evidenceValue(q,a,tier)) + ' · ' + TIERS[tier].score + ' PTS</small></div>';
    }).join('');
    status.textContent = matches.length ? 'แสดง ' + number(Math.min(shown,matches.length)) + ' จาก ' + number(matches.length) : 'ไม่พบคำตอบที่ตรงกับคำค้น';
    if (matches.length <= shown && document.activeElement === more) status.focus({preventScroll:true});
    more.hidden = matches.length <= shown;
  }
  filter.addEventListener('input', () => { shown = EVIDENCE_PAGE_SIZE; draw(); });
  more.addEventListener('click', () => { shown += EVIDENCE_PAGE_SIZE; draw(); });
  details.addEventListener('toggle', () => { if (details.open) draw(); });
}
function explainDialog(index) {
  const q = session?.questions[index], result = session?.results[index];
  if (!q || !result) return;
  const answer = q.answers.find(a=>a.id===result.answerId);
  const tiers=surveyTiers(q);
  const answerTier = answer ? tiers.get(answer.id) : null;
  let provenance = '';
  if (q.survey) {
    const survey = q.survey;
    provenance = '<p>' + esc(survey.sourceQuestion) + '</p>' +
      (answer ? '<p>คำตอบของคุณ: <strong>' + esc(answer.label) + '</strong> · ' + esc(evidenceValue(q,answer,answerTier)) + ' ตามข้อมูลต้นทาง</p>' : '') +
      '<div class="method-info">ผู้สำรวจ: ' + esc(survey.publisher) + '<br>ช่วงเก็บข้อมูล: ' + esc(survey.fieldwork) +
      '<br>กลุ่มตัวอย่าง: ' + esc(survey.population) + '<br>จำนวนตัวอย่าง: ' +
      (survey.sampleSize === null ? 'ตารางนี้ไม่ได้ระบุ' : esc(survey.sampleSizeQualifier || '') + number(survey.sampleSize) + ' ' + esc(survey.sampleUnit || 'คน')) +
      '<br>' + esc(survey.sampleNote) + '<br>' + esc(survey.metric) + '<br>' + esc(survey.coverage) +
      '<br><a href="' + safeUrl(survey.url) + '" target="_blank" rel="noopener noreferrer">ดูผลสำรวจต้นทาง ↗</a>' +
      (survey.licenseUrl ? ' · <a href="' + safeUrl(survey.licenseUrl) + '" target="_blank" rel="noopener noreferrer">สัญญาอนุญาต ↗</a>' : '') +
      (survey.translationNotice ? '<br>' + esc(survey.translationNotice) : '') + '</div>' +
      '<p>แต้มจัดตามอันดับค่าที่สำรวจได้ ค่าเท่ากันได้แต้มเท่ากัน</p>';
  } else {
    const curated = q.curated;
    const refs = curated.references?.length
      ? '<br>อ้างอิง: ' + curated.references.map(r => '<a href="' + safeUrl(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.label) + ' ↗</a>').join(' · ')
      : '';
    const reasonText = answer ? curatedReason(q, answer, answerTier) : '';
    provenance = (answer ? '<p>คำตอบของคุณ: <strong>' + esc(answer.label) + '</strong> · ' + esc(TIERS[answerTier].name) + ' (' + TIERS[answerTier].score + ' PTS)' +
      (reasonText ? '<br><small style="color:#9eb8cc">' + esc(reasonText) + '</small>' : '') + '</p>' : '') +
      '<div class="method-info">แหล่งที่มา: คลังคัดสรรตามความคุ้นเคย (Curated Familiarity · ไม่ใช่ผลสำรวจความถี่จากผู้ตอบ)<br>เกณฑ์จัดระดับ: ' +
      esc(curated.basis) + '<br>ขอบเขตคลัง: ' + esc(curated.coverage) +
      (curated.note ? '<br>' + esc(curated.note) : '') + refs + '</div>' +
      '<p>แต้มจัดตามระดับความคุ้นเคยของคำตอบในหมวดนี้</p>';
  }
  openModal('explain','Field notes · ' + (index+1),'<div class="body-copy"><p><strong>' + esc(q.prompt) + '</strong></p>' +
    provenance + '<div class="survey-inline-link"><button type="button" class="small-link" data-action="survey" data-index="' + index +
    '">ไม่เจอคำตอบที่อยากตอบ? เสนอเพิ่มเข้าคลัง ↗</button></div>' +
    '<details class="evidence-details"><summary>ดูคำตอบที่มีข้อมูล (' + number(q.answers.length) + ')</summary>' +
    '<label class="evidence-filter">ค้นหาชื่อคำตอบ <input type="search" placeholder="พิมพ์ชื่อหรือชื่อเรียกอื่น" autocomplete="off"></label>' +
    '<p class="evidence-status" role="status" tabindex="-1"></p><div class="answer-bank"></div>' +
    '<button type="button" class="evidence-more small-link" hidden>แสดงเพิ่ม</button></details></div>');
  wireEvidenceList(q,tiers);
}
const telemetryInFlight = new Set();
function sendTelemetryIfNeeded(doneSession) {
  if (!doneSession || doneSession.phase !== 'complete' || !surveySession(doneSession)) return;
  const sent = Array.isArray(save.telemetrySent) ? save.telemetrySent : [];
  if (sent.includes(doneSession.id) || telemetryInFlight.has(doneSession.id)) return;
  telemetryInFlight.add(doneSession.id);
  const clientId = ensureClientId(save);
  const payload = {
    sessionId: doneSession.id,
    clientId,
    mode: doneSession.mode,
    date: doneSession.date,
    bankVersion: doneSession.bankVersion,
    score: doneSession.score,
    depth: doneSession.depth,
    gems: doneSession.results.filter(r => r.tier === 'krillion').length,
    rounds: doneSession.results.map(r => ({
      questionId: r.questionId,
      reason: r.reason,
      answerId: r.answerId || '',
      label: r.label || '',
      tier: r.tier || '',
      points: r.points || 0,
      elapsedMs: r.elapsedMs || 0,
      rejectedInputs: Array.isArray(r.rejectedInputs) ? r.rejectedInputs : []
    }))
  };
  fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).then(r => {
    if (!r.ok) return;
    save.telemetrySent = [...new Set([...(save.telemetrySent || []), doneSession.id])].slice(-60);
    writeSave(save, globalThis.localStorage, bank);
  }).catch(() => {}).finally(() => {
    telemetryInFlight.delete(doneSession.id);
  });
}
function patchNotesDialog() {
  const totalAnswers = bank.questions.reduce((sum, q) => sum + q.answers.length, 0);
  const megaCount = bank.questions.filter(q => q.answers.length >= 1000).length;
  openModal('patchnotes', 'Patch Notes v' + APP_VERSION,
    '<header class="modal-hero">' +
      '<div class="modal-eyebrow">PATCH NOTES <span class="version-pill">v' + APP_VERSION + '</span></div>' +
      '<h3>มีอะไรใหม่ในอัปเดตนี้</h3>' +
      '<p>ยกเครื่องคลังคำถามและคำตอบครั้งใหญ่ ให้เล่นสนุก กว้าง ครอบคลุม และตรงใจคนไทยมากขึ้นครับ</p>' +
    '</header>' +
    '<div class="patch-scroll">' +
      '<div class="patch-stats">' +
        '<div class="patch-stat"><strong>' + number(bank.questions.length) + '</strong><span>โจทย์ไทย &amp; ทั่วไป</span></div>' +
        '<div class="patch-stat"><strong>' + number(totalAnswers) + '</strong><span>คำตอบทั้งหมดในคลัง</span></div>' +
        '<div class="patch-stat"><strong>' + number(megaCount) + '</strong><span>หมวดใหญ่ 1,000+ คำ</span></div>' +
      '</div>' +
      '<div class="patch-list">' +
        '<article class="patch-card">' +
          '<div class="patch-card-head"><span class="patch-tag is-new">NEW</span> เพิ่มโจทย์ใหม่ &amp; ขยายหมวดบันเทิงเป็นหลักพัน</div>' +
          '<ul>' +
            '<li>แยกโจทย์ <strong>อนิเมะญี่ปุ่น (2,735 เรื่อง)</strong> และเพิ่ม <strong>ละครไทย/ซีรีส์ไทย (1,705 เรื่อง)</strong></li>' +
            '<li>ขยายหมวดยอดฮิตทะลุพันคำตอบ: <strong>ซีรีส์ต่างประเทศ (2,553)</strong>, <strong>หนังต่างประเทศ (2,295)</strong>, <strong>ศิลปินต่างประเทศ (2,116)</strong>, <strong>วิดีโอเกม (2,048)</strong>, <strong>นักร้องเดี่ยวไทย (1,519)</strong>, <strong>หนังไทย (1,516)</strong>, <strong>เมืองดังทั่วโลก (1,391)</strong>, <strong>ตัวการ์ตูน (1,199)</strong> และ <strong>หนังแอนิเมชัน (1,175)</strong></li>' +
          '</ul>' +
        '</article>' +
        '<article class="patch-card">' +
          '<div class="patch-card-head"><span class="patch-tag is-gold">EXPANDED</span> จัดเต็มอาหารอีสาน &amp; หมวดรอบตัว 100+ ทุกข้อ</div>' +
          '<ul>' +
            '<li>ขยายหมวด <strong>อาหารอีสาน</strong> เป็น <strong>273 เมนู</strong> ครบทั้งส้มตำทุกตำรับ ลาบ ก้อย ซอยจุ๊ เสือร้องไห้ แกงอ่อม แกงเปรอะ หมก ป่น แจ่วบอง ฯลฯ</li>' +
            '<li>ขยายทุกหมวดปลายเปิดให้เกิน 100 คำตอบ ทั้งผลไม้ รสไอศกรีม อาหารตามสั่ง ขนมไทย เครื่องดื่ม สี เครื่องมือ เครื่องดนตรี เสื้อผ้า กีฬา วัดไทย และอุทยานแห่งชาติ</li>' +
          '</ul>' +
        '</article>' +
        '<article class="patch-card">' +
          '<div class="patch-card-head"><span class="patch-tag">REFINED</span> ขยายหมวดสัตว์ &amp; คัดตัดโจทย์ที่เจาะจงเกินไป</div>' +
          '<ul>' +
            '<li>ขยายหมวด <strong>สัตว์ (1,257 ชนิด)</strong> และ <strong>สัตว์รอบบ้านไทย (110 ชนิด)</strong> เพิ่มสัตว์ใกล้ตัวอย่าง จิ้งจก ตุ๊กแก ตัวเงินตัวทอง ครบถ้วน</li>' +
            '<li>ถอดโจทย์เฉพาะทางหรือวิชาการที่ยากเกินไปออก เหลือเฉพาะโจทย์ใกล้ตัวที่ชวนนึกคำตอบได้จริง</li>' +
          '</ul>' +
        '</article>' +
        '<article class="patch-card">' +
          '<div class="patch-card-head"><span class="patch-tag is-new">SURVEY</span> ปุ่มเสนอคำตอบเพิ่มหลังจบเกม</div>' +
          '<ul>' +
            '<li>เล่นครบ 7 ข้อแล้วสามารถกดเสนอคำตอบที่นึกออกแต่ยังไม่มีในคลังได้ทันทีแบบติดแท็กทีละข้อ เพื่อนำไปอัปเดตเพิ่มในรอบถัดไป</li>' +
          '</ul>' +
        '</article>' +
      '</div>' +
    '</div>' +
    '<footer class="patch-footer"><button type="button" class="primary-button survey-submit" data-action="close">เข้าใจแล้ว ลุยดำน้ำเลย →</button></footer>');
}
function surveyDialog(initialIndex = null) {
  if (!session?.questions?.length) return;
  const cardTags = session.questions.map(() => []);
  const usedChipsByCard = session.questions.map(() => false);
  const submittedCards = new Set();

  const cardsHtml = session.questions.map((q, i) => {
    const r = session.results[i];
    const color = r?.tier ? tierColor(r.tier) : '#f45388';
    const outcomeText = r?.tier ? (r.label ? r.label + ' · ' + r.points : r.points + ' PTS') : (r?.reason === 'timeout' ? 'หมดเวลา' : 'ข้ามข้อ');
    const rej = Array.isArray(r?.rejectedInputs) ? r.rejectedInputs : [];
    const chipsHtml = rej.length
      ? '<div class="survey-chips-wrap"><span class="survey-chips-label">พิมพ์แล้วไม่พบในคลัง (แตะเพื่อเพิ่มเป็นแท็ก):</span>' +
        rej.map(word => '<button type="button" class="survey-chip" data-chip-card="' + i + '" data-chip="' + esc(word) + '">+ ' + esc(word) + '</button>').join('') +
        '</div>'
      : '';
    return '<article class="survey-card" data-survey-card="' + i + '">' +
      '<div class="survey-card-head">' +
        '<div class="survey-card-title">' +
          '<span class="survey-num">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<div class="survey-prompt">' + esc(q.prompt) + '</div>' +
        '</div>' +
        '<span class="survey-outcome" style="--tier:' + color + '">' + esc(outcomeText) + '</span>' +
      '</div>' +
      chipsHtml +
      '<div class="tag-box" data-tag-box="' + i + '">' +
        '<div class="tag-input-row">' +
          '<input type="text" class="tag-input" data-tag-input="' + i + '" maxlength="120" autocomplete="off" placeholder="พิมพ์คำตอบที่ควรมีแล้วกด Enter...">' +
          '<button type="button" class="tag-add-btn" data-tag-add="' + i + '">+ เพิ่ม</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }).join('');

  openModal('survey', 'Pool Survey',
    '<header class="modal-hero">' +
      '<div class="modal-eyebrow">POOL SURVEY <span class="version-pill">7 PROMPTS</span></div>' +
      '<h3>เสนอคำตอบที่ควรมีเพิ่มในคลัง</h3>' +
      '<p>พิมพ์คำตอบในข้อที่ต้องการแล้วกด <strong>Enter</strong> เพื่อติดแท็ก เสนอหลายข้อพร้อมกันได้ในครั้งเดียวครับ</p>' +
    '</header>' +
    '<form id="survey-form" style="display:contents">' +
      '<div class="survey-scroll" id="survey-scroll">' +
        cardsHtml +
        '<div class="survey-note-box">' +
          '<label for="survey-note">หมายเหตุเพิ่มเติมหรือชื่อเรียกอื่น (ไม่บังคับ)</label>' +
          '<input id="survey-note" type="text" maxlength="400" placeholder="เช่น ชื่อภาษาอังกฤษ หรือข้อเสนอแนะเพิ่มเติมสำหรับรอบนี้">' +
        '</div>' +
      '</div>' +
      '<footer class="survey-footer">' +
        '<div class="survey-footer-meta">' +
          '<span class="survey-counter" id="survey-counter">ยังไม่ได้เพิ่มคำตอบ</span>' +
          '<p class="survey-status" id="survey-status" role="status"></p>' +
        '</div>' +
        '<button type="submit" class="primary-button survey-submit" id="survey-submit">ส่งข้อเสนอทั้งหมด →</button>' +
      '</footer>' +
    '</form>');

  const form = document.getElementById('survey-form');
  const scrollBox = document.getElementById('survey-scroll');
  const noteEl = document.getElementById('survey-note');
  const counterEl = document.getElementById('survey-counter');
  const statusEl = document.getElementById('survey-status');
  const submitBtn = document.getElementById('survey-submit');
  const normKey = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

  function updateCounter() {
    const totalTags = cardTags.reduce((sum, list) => sum + list.length, 0);
    const activeCards = cardTags.filter(list => list.length > 0).length;
    if (!totalTags) {
      counterEl.innerHTML = 'พิมพ์คำตอบในข้อที่ต้องการแล้วกด <strong>Enter</strong>';
      submitBtn.textContent = 'ส่งข้อเสนอทั้งหมด →';
    } else {
      counterEl.innerHTML = 'พร้อมส่ง <strong>' + totalTags + ' คำตอบ</strong> จาก <strong>' + activeCards + ' ข้อ</strong>';
      submitBtn.textContent = 'ส่งข้อเสนอทั้งหมด (' + totalTags + ') →';
    }
  }

  function renderCardTags(idx) {
    const box = scrollBox.querySelector('[data-tag-box="' + idx + '"]');
    const inputRow = box.querySelector('.tag-input-row');
    for (const el of [...box.querySelectorAll('.answer-tag')]) el.remove();
    const list = cardTags[idx];
    for (let t = 0; t < list.length; t++) {
      const span = document.createElement('span');
      span.className = 'answer-tag';
      span.innerHTML = esc(list[t]) + '<button type="button" data-tag-remove="' + idx + ':' + t + '" aria-label="ลบ ' + esc(list[t]) + '">×</button>';
      box.insertBefore(span, inputRow);
    }
    const card = scrollBox.querySelector('[data-survey-card="' + idx + '"]');
    card.classList.toggle('is-active', list.length > 0);
    for (const chip of card.querySelectorAll('[data-chip]')) {
      const used = list.some(v => normKey(v) === normKey(chip.dataset.chip));
      chip.classList.toggle('is-used', used);
    }
    updateCounter();
  }

  function addTagsToCard(idx, rawText, fromChip = false) {
    const parts = String(rawText || '').split(/[\n,;،]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (!parts.length) return 0;
    let added = 0;
    const list = cardTags[idx];
    for (const p of parts) {
      if (list.length >= 10) break;
      const val = p.slice(0, 120);
      if (list.some(item => normKey(item) === normKey(val))) continue;
      list.push(val);
      added++;
    }
    if (fromChip && added > 0) usedChipsByCard[idx] = true;
    if (added > 0) {
      statusEl.textContent = '';
      renderCardTags(idx);
    }
    return added;
  }

  scrollBox.addEventListener('click', e => {
    const rem = e.target.closest('[data-tag-remove]');
    if (rem) {
      const [idx, t] = rem.dataset.tagRemove.split(':').map(Number);
      cardTags[idx].splice(t, 1);
      renderCardTags(idx);
      scrollBox.querySelector('[data-tag-input="' + idx + '"]')?.focus();
      return;
    }
    const addBtn = e.target.closest('[data-tag-add]');
    if (addBtn) {
      const idx = Number(addBtn.dataset.tagAdd);
      const input = scrollBox.querySelector('[data-tag-input="' + idx + '"]');
      if (input && input.value.trim()) {
        addTagsToCard(idx, input.value);
        input.value = '';
      }
      input?.focus();
      return;
    }
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      const idx = Number(chip.dataset.chipCard);
      const word = chip.dataset.chip;
      const existingIdx = cardTags[idx].findIndex(v => normKey(v) === normKey(word));
      if (existingIdx >= 0) {
        cardTags[idx].splice(existingIdx, 1);
        renderCardTags(idx);
      } else {
        addTagsToCard(idx, word, true);
      }
      return;
    }
    const box = e.target.closest('[data-tag-box]');
    if (box && !e.target.closest('button')) {
      box.querySelector('.tag-input')?.focus();
    }
  });

  scrollBox.addEventListener('keydown', e => {
    const input = e.target.closest('[data-tag-input]');
    if (!input) return;
    const idx = Number(input.dataset.tagInput);
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (input.value.trim()) {
        addTagsToCard(idx, input.value);
        input.value = '';
      }
    } else if (e.key === 'Backspace' && !input.value && cardTags[idx].length) {
      cardTags[idx].pop();
      renderCardTags(idx);
    }
  });

  scrollBox.addEventListener('paste', e => {
    const input = e.target.closest('[data-tag-input]');
    if (!input) return;
    const text = e.clipboardData?.getData('text') || '';
    if (/[\n,;]/.test(text)) {
      e.preventDefault();
      addTagsToCard(Number(input.dataset.tagInput), text);
    }
  });

  if (Number.isInteger(initialIndex) && initialIndex >= 0 && initialIndex < session.questions.length) {
    const targetCard = scrollBox.querySelector('[data-survey-card="' + initialIndex + '"]');
    requestAnimationFrame(() => {
      targetCard?.scrollIntoView({ block: 'center', behavior: 'instant' });
      targetCard?.querySelector('.tag-input')?.focus();
    });
  }
  updateCounter();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    // Flush any uncommitted text in inputs into tags automatically
    for (const input of scrollBox.querySelectorAll('[data-tag-input]')) {
      if (input.value.trim()) {
        addTagsToCard(Number(input.dataset.tagInput), input.value);
        input.value = '';
      }
    }
    const items = [];
    for (let i = 0; i < session.questions.length; i++) {
      if (!cardTags[i].length) continue;
      items.push({
        questionId: session.questions[i].id,
        questionPrompt: session.questions[i].prompt,
        suggestions: [...cardTags[i]],
        source: usedChipsByCard[i] ? 'rejected-chip' : 'survey',
      });
    }
    if (!items.length) {
      statusEl.className = 'survey-status is-error';
      statusEl.textContent = 'กรุณาพิมพ์คำตอบอย่างน้อย 1 ข้อแล้วกด Enter ครับ';
      scrollBox.querySelector('[data-tag-input="0"]')?.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'กำลังบันทึก...';
    statusEl.className = 'survey-status';
    statusEl.textContent = '';

    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          note: noteEl.value.trim(),
          bankVersion: session.bankVersion || bank.version,
          mode: session.mode,
          sessionId: session.id,
          clientId: ensureClientId(save),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'บันทึกไม่สำเร็จ (รหัส ' + res.status + ')');
      }
      for (let i = 0; i < session.questions.length; i++) {
        if (!cardTags[i].length) continue;
        submittedCards.add(i);
        cardTags[i] = [];
        usedChipsByCard[i] = false;
        renderCardTags(i);
        const card = scrollBox.querySelector('[data-survey-card="' + i + '"]');
        card.classList.add('is-submitted');
        const head = card.querySelector('.survey-card-head');
        if (!head.querySelector('.survey-card-sent')) {
          const badge = document.createElement('span');
          badge.className = 'survey-card-sent';
          badge.textContent = '✓ ส่งแล้ว';
          head.appendChild(badge);
        }
      }
      noteEl.value = '';
      statusEl.className = 'survey-status';
      statusEl.textContent = 'บันทึกแล้ว ' + data.saved + ' คำตอบ (' + (data.questionsSaved || items.length) + ' ข้อ) ขอบคุณมากครับ!';
      toast('ส่งคำตอบที่เสนอ ' + data.saved + ' รายการเรียบร้อยแล้ว');
      audio?.play('spare');
    } catch (err) {
      statusEl.className = 'survey-status is-error';
      statusEl.textContent = err.message || 'ส่งไม่สำเร็จในขณะนี้ กรุณาลองใหม่อีกครั้ง';
    } finally {
      submitBtn.disabled = false;
      updateCounter();
    }
  });
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
    const selected=save.history[Number(historyItem.dataset.history)];
    if (!surveySession(selected)) return;
    session = structuredClone(selected);
    closeModal(); view = 'history-result'; render(); window.scrollTo({top:0,behavior:'instant'}); return;
  }
  const resumeItem=event.target.closest('[data-resume]');
  if(resumeItem) {
    const old=savedSessions(save).find(s=>s.id===resumeItem.dataset.resume&&surveySession(s));
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
    case 'patchnotes': patchNotesDialog(); break;
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
    case 'survey': surveyDialog(button.dataset.index != null ? Number(button.dataset.index) : null); break;
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
    const nodes = [...modalRoot.querySelectorAll('button:not(:disabled),a[href],input,select,textarea,summary')].filter(el=>el.getClientRects().length);
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
