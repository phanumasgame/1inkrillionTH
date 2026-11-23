import { ANSWER_MS, PREVIEW_MS, TIME_ZONE, TIERS, TIER_ORDER, DIVE_GROUPS, getDiveGroup, dayKey, selectDaily, selectEndless,
  createSession, tickSession, submitAnswer, confirmCorrection, skipRound, nextRound, shareText, prewarmQuestionIndex } from './game.js';
import { readSave, writeSave, emptySave, ensureClientId, validSession, dailySlot, endlessSlot, prepareSaveForBank, currentSavedSession, savedSessions } from './storage.js';
import { curatedReason, isSurveySession, prepareSurveyBank, starterExample, surveyTiers, surveyValue } from './survey.js';
import { answerForms } from './answers.js';
import { DiveAudio } from './audio.js';
import { OceanScene } from './scene.js';
import { descentDuration, PIXELS_PER_METER, METERS_PER_POINT } from './descent.js';
import { focusAnswer } from './input.js';

const APP_VERSION = '1.1.1';
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
let bank, audio, scene;
let save = emptySave();
function parseRoute(pathname = location.pathname) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return { route: 'admin', mode: 'daily', group: 'classic' };
  if (pathname.startsWith('/unlimited')) {
    const seg = pathname.replace(/^\/unlimited\/?/, '').split('/')[0] || 'classic';
    const grp = DIVE_GROUPS.some(g => g.id === seg) ? seg : 'classic';
    return { route: 'game', mode: 'endless', group: grp };
  }
  return { route: 'game', mode: 'daily', group: 'classic' };
}
let { route: activeRoute, mode, group: activeGroup } = parseRoute();
let session = null, view = 'home', composing = false, lastTick = -1, lastTierLine = null, landed = false, inputSaveTimer, toastTimer;
let prewarmTimer = null;
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
  if (activeRoute === 'admin') {
    document.title = 'Krillion TH · Admin';
    try {
      const { mountAdminBackoffice } = await import('/src/admin.js?v=' + APP_VERSION);
      scene = new OceanScene();
      scene.set(1600, false, false, true);
      mountAdminBackoffice(app, { version: APP_VERSION, onToast: toast });
    } catch (error) {
      app.innerHTML = '<div class="dialog" style="margin:20vh auto"><h2>Admin Load Error</h2><p class="thai">' + esc(error.message) + '</p></div>';
      console.error(error);
    }
    return;
  }
  try {
    const results = await Promise.allSettled([
      fetch('/data/survey-bank.json?v=' + APP_VERSION).then(r => { if (!r.ok) throw new Error('คลังผลสำรวจโหลดไม่สำเร็จ'); return r.json(); }),
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
function schedulePrewarm(targetSession) {
  clearTimeout(prewarmTimer);
  const q = targetSession?.questions?.[targetSession.index];
  if (!q || !['preview', 'answer'].includes(targetSession?.phase)) return;
  prewarmTimer = setTimeout(() => prewarmQuestionIndex(q), 40);
}
function currentSceneGroup() {
  if (session?.mode === 'endless') return session.group || 'classic';
  return mode === 'endless' ? activeGroup : 'classic';
}
function getSaved() {
  const candidate = currentSavedSession(save, mode, dayKey(), bank.version, activeGroup);
  return surveySession(candidate) ? candidate : null;
}
function restoreCurrent() {
  const requested=savedSessions(save).find(s=>s.id===save.resumeSessionId&&s.phase!=='complete'&&surveySession(s));
  const saved = requested?.mode===mode && (!requested?.group || requested.group === activeGroup) ? requested : getSaved();
  session = surveySession(saved) ? saved : null;
  view = session ? session.phase === 'complete' ? 'results' : 'play' : 'home';
  scene?.setGroupTheme?.(currentSceneGroup());
  if (session) {
    session = tickSession(session);
    if (scene.reducedMotion && session.phase === 'sinking')
      session = { ...session, phaseUntil: Math.min(session.phaseUntil, Date.now() + 120) };
    lastTierLine = null; landed = false;
    if (session.phase === 'sinking' && session.results.at(-1)?.points) syncScene();
    else scene.set(session.depth, true, save.settings.lowPower, true);
    schedulePrewarm(session);
    persist();
  } else scene.set(0, false, save.settings.lowPower, true);
}
function persist() {
  if (!bank) return;
  if (session && view !== 'history-result') {
    if (session.mode === 'daily') save.daily[dailySlot(session.date,session.bankVersion)] = session;
    else {
      const slot = endlessSlot(session.bankVersion, session.group || 'classic');
      save.endlessByBank[slot] = session;
      if (session.bankVersion === bank.version && (!session.group || session.group === 'classic')) save.endless = session;
    }
    if (session.phase === 'complete' && !save.history.some(item => item.id === session.id)) {
      const { questions, ...rest } = session;
      save.history.unshift({ ...structuredClone(rest), questions });
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
const BUDDY_LINES = {
  plankton: ['แพลงก์ตอนตัวจิ๋ว!', 'คำตอบธรรมดาก็ได้แต้มนะ', 'ค่อยๆ ลงลึกทีละเมตร~'],
  krillion: ['บลุ๊บ~ ลงไปหา Krillion กัน!', 'ลองนึกคำเฉพาะทางดูสิ ✨', '30 วิเต็มที่เลย!'],
  'krillion-gold': ['ทองวิบวับระดับตำนาน ✨', 'รอบนี้ต้องมี Krillion อีกแน่!', 'บลุ๊บ~ ฉลองเจ้าสมุทร!'],
  schooler: ['ว่ายเป็นฝูงอุ่นใจกว่า', 'ลองคำที่คุ้นหูแต่ไม่แมสสุดดู', '30 แต้มก็นำทางลงลึกได้!'],
  'schooler-gold': ['ฝูงทองนำทางสู่ก้นทะเล ✨', 'สายสม่ำเสมอตัวจริง!', 'ไปต่อให้ถึง Abyss เลย!'],
  rare: ['ลึกขนาดนี้ต้องมี Rare 💎', 'ลองชื่อเฉพาะหรือคำลึกอีกนิด', 'จ้องดีๆ คำ Rare ซ่อนอยู่'],
  deepcut: ['80 แต้มรออยู่ข้างล่าง...', 'มืดแล้วแต่อย่าเพิ่งยอมแพ้!', 'คำลึกซ่อนตัวอยู่ในความมืด'],
  tooclever: ['ฮึ! คิดลึกไปหรือเปล่านะ?', 'พองลมรออยู่ตรงนี้แหละ!', 'ตอบหลุดคลังระวัง Too Clever~'],
  axolotl: ['เร็วปานสายฟ้า~ ⚡', '30 วิเหลือเฟือ ลุยเลย!', 'ยิ้มสู้ไว้เดี๋ยวก็เจอ Krillion!'],
  narwhal: ['ยูนิคอร์นแห่งท้องทะเล 🦄', 'นึกคำระดับ 500+ แต้ม!', 'เขาวิเศษชี้นำทางลงก้นสมุทร'],
  seadragon: ['พลิ้วไหวดั่งมังกรทะเล 🌿', 'Rare รวด 7 ข้อทำได้ไหมนะ?', 'ใจเย็นๆ ค่อยๆ นึกคำคมๆ'],
  kraken: ['เจ้าแห่งห้วงลึกตื่นแล้ว 🐙', '600+ แต้มอยู่แค่เอื้อม!', 'กางหนวดรับพลังแห่ง Abyss!']
};
const BUDDY_REACTIONS = ['is-hop', 'is-spin', 'is-dash'];
const BUDDY_SPARK_IDS = new Set(['rare', 'deepcut', 'krillion', 'krillion-gold', 'schooler-gold', 'narwhal', 'seadragon', 'kraken']);

function friend(diving = false) {
  const buddyId = save.character || 'krillion';
  const atPrompt = !diving && view === 'play' && ['preview','answer','correction'].includes(session.phase);
  const tier = session?.results?.at(-1)?.tier;
  const celebrate = diving && ['rare', 'deepcut', 'krillion'].includes(tier);
  return '<button class="friend' + (diving ? ' dive-friend' : atPrompt ? ' at-prompt' : '') + (celebrate ? ' is-celebrate' : '') +
    '" data-action="blub" data-buddy="' + esc(buddyId) + '" aria-label="a friend"><img' + goldSprite(buddyId) + ' src="' +
    sprite(buddyId) + '" alt=""><span class="buddy-bubbles" aria-hidden="true"></span></button>';
}
function groupPacksStrip(compact = false) {
  return '<div class="pack-grid' + (compact ? ' is-compact' : '') + '" role="navigation" aria-label="Themed dive expeditions">' +
    DIVE_GROUPS.map(g => {
      const selected = mode === 'endless' && activeGroup === g.id;
      return '<button type="button" class="pack-pill pack-' + g.id + (selected ? ' is-active' : '') +
        '" data-action="endless-group" data-group="' + g.id + '" title="' + esc(g.subtitle) + '">' +
        '<span class="pack-emoji">' + g.emoji + '</span><span class="pack-name">' + esc(compact ? g.shortTitle : g.title) + '</span>' +
        (compact ? '' : '<small>' + esc(g.subtitle) + '</small>') + '</button>';
    }).join('') + '</div>';
}
function landing() {
  const today = dayKey();
  const saved = getSaved();
  const canResume = validSession(saved) && saved.phase !== 'complete';
  const completed = mode === 'daily' && saved?.phase === 'complete';
  const label = completed ? 'VIEW YOUR DIVE' : canResume ? 'RESUME DESCENT' : 'BEGIN DESCENT';
  const group = getDiveGroup(activeGroup);
  const title = mode === 'daily' ? 'THE DAILY DIVE' : group.id === 'classic' ? 'THE ENDLESS DIVE' : group.title;
  const sub = mode === 'daily'
    ? '7 prompts · 30 seconds each · rarer answers sink deeper'
    : (group.id === 'classic' ? 'dive after dive · 30 seconds each · rarer answers sink deeper' : group.oceanTitle + ' · ' + group.subtitle);
  const currentRun = activeGroup === 'classic' ? save.run : (save.runByGroup?.[activeGroup] || 0);
  return '<main class="landing">' + controls() +
    '<header class="hero"><div class="wordmark" aria-label="Krillion TH">KRILLION</div><h1>' + esc(title) + '</h1>' +
    '<p>' + esc(sub) + '</p></header>' +
    friend() + '<section class="landing-bottom">' +
    '<details class="howto"><summary>how to play</summary><ol>' +
    '<li>SEVEN PROMPTS. A SHARED DAILY CHALLENGE.</li><li>30 SECONDS. TYPE ONE ANSWER THAT FITS.</li>' +
    '<li>LOWER OR RARER RANKS CAN SINK DEEPER.</li><li>ONLY ANSWERS IN THIS DIVE’S BANK CAN SCORE.</li>' +
    '<li>ONE POINT = 10 METRES. AIM FOR 7,000M.</li><li>ONE DAILY ATTEMPT. PICK AN EXPEDITION GROUP ANYTIME.</li></ol></details>' +
    '<div class="landing-credits"><button class="small-link" data-action="about">About this dive</button>' +
    '<button class="landing-patch-btn" data-action="patchnotes">✦ Patch Notes · v' + APP_VERSION + '</button></div>' +
    (mode === 'daily'
      ? '<button class="discovery-card" data-action="endless"><span class="discovery-tag">DIVE AFTER DIVE · EXPEDITIONS</span><img src="' +
        sprite('schooler') + '" alt=""><span>ENDLESS &amp; THEMED DIVES</span><small>∞</small></button>' + groupPacksStrip(true)
      : groupPacksStrip(false)) +
    '<button class="begin" data-action="begin">▼ ' + label + ' ▼</button>' +
    '<div class="landing-nav"><span>' + (mode === 'daily' ? 'DIVE · ' + today : group.shortTitle + ' DIVE #' + (canResume ? saved.run : currentRun + 1)) + '</span>' +
    '<div><button data-action="history">DIVE LOG ⟲</button><button data-action="' + (mode === 'daily' ? 'endless' : 'daily') + '">' +
    (mode === 'daily' ? 'UNLIMITED ∞' : 'TODAY’S DIVE') + '</button></div></div></section>' +
    '<div class="reference-footer">KRILLION TH · v' + APP_VERSION + '</div></main>';
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
    '<div class="timer-row"><span>MAKE IT COUNT.</span><span class="timer-number" id="timer" role="timer" aria-label="Seconds remaining">30</span></div>' +
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
  const groupInfo = session.mode === 'endless' ? getDiveGroup(session.group || 'classic') : null;
  const overline = session.mode === 'daily'
    ? 'DAILY DIVE · ' + session.date
    : (groupInfo && groupInfo.id !== 'classic' ? groupInfo.title + ' #' + session.run : 'ENDLESS DIVE #' + session.run);
  return '<main class="results-view">' + controls() +
    '<p class="overline">' + esc(overline) + '</p>' +
    '<h1>' + title + '</h1><div class="results-depth">' + number(session.depth) + '<span style="font-size:35px">m</span></div>' +
    '<p class="results-sub">' + session.score + ' / 700 POINTS · ' + gems + ' KRILLION' + (gems === 1 ? '' : 'S') + '</p>' +
    '<div class="results-graph" aria-label="Score for each of seven prompts">' + session.results.map((r, i) =>
      '<div class="graph-column" style="--tier:' + (r.tier ? tierColor(r.tier) : '#40526a') + '"><i style="height:' +
      r.points + '%"></i><span>' + (i + 1) + '</span></div>').join('') + '</div>' +
    '<div class="results-actions"><button class="primary-button" data-action="share">SHARE / SAVE IMAGE ↗</button>' +
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
  const grp = getDiveGroup(activeGroup);
  document.title = 'Krillion TH · ' + (mode === 'daily' ? 'the daily dive' : grp.id === 'classic' ? 'the endless dive' : grp.shortTitle.toLowerCase());
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
  scene?.setGroupTheme?.(currentSceneGroup());
  const result = view === 'play' && session?.phase === 'sinking' ? session.results.at(-1) : null;
  if (result?.points) {
    const startedAt = Number.isFinite(result.answeredAt)
      ? result.answeredAt : session.phaseUntil - descentDuration(result.points);
    scene.setDescent(session.depth - result.points * METERS_PER_POINT, session.depth,
      startedAt, session.phaseUntil, save.settings.lowPower, result.tier);
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
  if (session.phase !== previous?.phase || session.index !== previous?.index) {
    schedulePrewarm(session);
  }
  if (session.phase !== previous?.phase) {
    if (session.phase === 'answer' && previous?.phase === 'preview') audio.play('category');
    if (session.phase === 'sinking') {
      if (scene.reducedMotion) session = { ...session, phaseUntil: Math.min(session.phaseUntil, Date.now() + 120) };
      audio.play(session.results.at(-1).points ? 'sink' : 'miss');
      lastTick = -1; lastTierLine = 0; landed = false;
    }
    if (session.phase === 'reveal') {
      const tier = session.results.at(-1).tier;
      if (tier) scene.pulseTier?.(tier);
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
  const bankIds = new Set(bank.questions.map(q => q.id));
  const knownSeen = new Set(save.seen);
  const recentSessions = [
    ...Object.values(save.daily || {}),
    save.endless,
    ...(save.history || []).slice(0, 15)
  ].filter(s => validSession(s) && s.bankVersion === bank.version);
  for (const s of recentSessions) {
    for (const q of s.questions || []) {
      if (q?.id && bankIds.has(q.id) && !knownSeen.has(q.id)) {
        knownSeen.add(q.id);
        save.seen.push(q.id);
      }
    }
  }
  let questions;
  let runNumber = 1;
  if (mode === 'daily') {
    questions = selectDaily(bank, date);
    for (const q of questions) {
      if (!knownSeen.has(q.id)) {
        knownSeen.add(q.id);
        save.seen.push(q.id);
      }
    }
  } else {
    save.seenByGroup = save.seenByGroup || {};
    save.runByGroup = save.runByGroup || {};
    const prevRun = activeGroup === 'classic' ? save.run : (save.runByGroup[activeGroup] || 0);
    runNumber = prevRun + 1;
    const groupSeen = activeGroup === 'classic'
      ? (Array.isArray(save.seen) ? save.seen : [])
      : (Array.isArray(save.seenByGroup[activeGroup]) ? save.seenByGroup[activeGroup] : []);
    const selection = selectEndless(bank, groupSeen, Math.random, runNumber, activeGroup);
    questions = selection.questions;
    if (activeGroup === 'classic') {
      save.seen = selection.seen;
      save.seenByGroup.classic = selection.seen;
    } else {
      save.seenByGroup[activeGroup] = selection.seen;
      const merged = (Array.isArray(save.seen) ? save.seen : []).filter(id => !questions.some(q => q.id === id));
      save.seen = [...merged, ...questions.map(q => q.id)].slice(-bank.questions.length);
    }
    if (activeGroup === 'classic') save.run = runNumber;
    else save.runByGroup[activeGroup] = runNumber;
  }
  session = createSession({mode,bank,questions,date,run: runNumber, group: activeGroup});
  view = 'play'; lastTick = -1; audio.play('begin'); schedulePrewarm(session); persist(); render();
  window.scrollTo({top:0,behavior:'instant'});
}
function changeMode(nextMode, nextGroup = activeGroup) {
  save.resumeSessionId=null;
  if (session && view !== 'history-result') persist();
  else writeSave(save, globalThis.localStorage, bank);
  mode = nextMode;
  activeGroup = mode === 'endless' ? (DIVE_GROUPS.some(g => g.id === nextGroup) ? nextGroup : 'classic') : 'classic';
  closeModal();
  history.pushState({}, '', mode === 'daily' ? '/' : getDiveGroup(activeGroup).route);
  const saved = getSaved();
  session = surveySession(saved) ? saved : null;
  view = 'home';
  scene?.setGroupTheme?.(currentSceneGroup());
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
    DIVE_GROUPS.map(g =>
      '<button data-action="endless-group" data-group="' + g.id + '"' +
      (mode === 'endless' && activeGroup === g.id ? ' class="selected"' : '') + '>' +
      g.emoji + ' ' + esc(g.shortTitle) + '</button>'
    ).join('') +
    '</nav><div class="nav-caption" style="margin-top:16px">LOG &amp; EXTRAS</div><nav>' +
    '<button data-action="history">⟲ Dive log</button><button data-action="wardrobe">Wardrobe</button>' +
    '<button data-action="patchnotes">✦ Patch Notes <span>v' + APP_VERSION + '</span></button>' +
    '<button data-action="settings">Settings</button><button data-action="about">About &amp; sources</button></nav>' +
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
  const validHistory = save.history.filter(s => Array.isArray(s?.results));
  const completed = save.history.length;
  const gems = validHistory.reduce((n, s) => n + s.results.filter(r => r.tier === 'krillion').length, 0);
  const bestScore = Math.max(0, ...validHistory.map(s => Number(s.score) || 0));
  const maxGemsInRun = Math.max(0, ...validHistory.map(s => s.results.filter(r => r.tier === 'krillion').length));
  const hasDaily = validHistory.some(s => s.mode === 'daily');
  const hasEndless = validHistory.some(s => s.mode === 'endless');
  const distinctGroups = new Set(validHistory.filter(s => s.mode === 'endless').map(s => s.group || 'classic')).size;
  const fastPerfectDive = validHistory.some(s => {
    if ((Number(s.score) || 0) < 400 || s.results.length < 7 || s.results.some(r => !r.points)) return false;
    const times = s.results.map(r => (typeof r.elapsedMs === 'number' && r.elapsedMs > 0) ? r.elapsedMs : 99999);
    return times.reduce((a, b) => a + b, 0) / s.results.length < 12000;
  });
  const rareSweepDive = validHistory.some(s => s.results.length >= 7 && s.results.every(r => ['rare', 'deepcut', 'krillion'].includes(r.tier)));
  const characters = [
    ['krillion', 'a little friend', true, 'your first dive buddy'],
    ['schooler', 'schooler', completed >= 1, 'finish 1 dive'],
    ['rare', 'rare companion', completed >= 3, 'finish 3 dives'],
    ['deepcut', 'deep cut', completed >= 7, 'finish 7 dives'],
    ['krillion-gold', 'golden buddy', gems >= 1, 'find 1 Krillion'],
    ['schooler-gold', 'golden schooler', gems >= 3, 'find 3 Krillions'],
    ['plankton', 'plankton buddy', completed >= 10, 'ดำครบ 10 รอบ'],
    ['tooclever', 'too clever', hasDaily && hasEndless && bestScore >= 350, 'Daily + Endless & ≥ 350 pts'],
    ['axolotl', 'axolotl', fastPerfectDive, '≥ 400 pts · 7/7 < 12s'],
    ['narwhal', 'narwhal', bestScore >= 500, 'ทำ ≥ 500 แต้มในรอบเดียว'],
    ['seadragon', 'sea dragon', rareSweepDive, 'Rare+ รวดเดียว 7 ข้อ'],
    ['kraken', 'abyssal kraken', bestScore >= 600 || maxGemsInRun >= 3 || distinctGroups >= 5, '≥ 600 pts · 3 Krillions · 5 หมวด']
  ];
  openModal('wardrobe','Your dive buddy','<div class="wardrobe-grid">' + characters.map(([id,title,unlocked,detail]) =>
    '<button class="wardrobe-item' + (save.character === id ? ' selected' : '') + '" data-character="' + id + '"' +
    (!unlocked ? ' disabled' : '') + '><img' + goldSprite(id) + ' src="' + sprite(id) + '" alt=""><span>' + title + '</span><small>' +
    (unlocked ? save.character === id ? 'EQUIPPED' : 'SELECT' : '🔒 ' + detail) + '</small></button>').join('') +
    '</div><p class="method-info">ตัวละคร 12 สายพันธุ์ปลดล็อกจากสถิติและภารกิจการดำน้ำในเครื่องนี้ (คลิก Buddy เพื่อคุยหรือดูท่าทางได้)</p>');
}
function sessionHistoryLabel(s) {
  if (s.mode === 'daily') return 'Daily · ' + esc(s.date);
  const grp = getDiveGroup(s.group || 'classic');
  return (grp.id === 'classic' ? 'Endless' : grp.shortTitle) + ' #' + s.run;
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
      '<button class="history-item" data-resume="'+esc(s.id)+'"><span>'+sessionHistoryLabel(s)+
      '<small>เล่นต่อ · ข้อ '+(s.index+1)+'/7'+(s.bankVersion!==bank.version?' · ชุดก่อนหน้า':'')+
      '</small></span><strong>RESUME →</strong></button>').join(''):'') +
    (history.length ? history.map(({s,i}) =>
    '<button class="history-item" data-history="' + i + '"><span>' + sessionHistoryLabel(s) +
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
  let names = null;
  function ensureNames() {
    if (!names) names = ordered.map(a => [a.label, ...a.aliases].flatMap(answerForms));
    return names;
  }
  function draw() {
    const terms = answerForms(filter.value).filter(Boolean);
    const searchNames = terms.length ? ensureNames() : null;
    const matches = terms.length ? ordered.filter((_, i) => terms.some(t=>searchNames[i].some(n=>n.includes(t)))) : ordered;
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
function getPatchHistory(totalAnswers, megaCount) {
  return [
    {
      version: '1.1.1',
      badge: 'ล่าสุด',
      headline: 'มีอะไรใหม่ใน v1.1.1 · Krillion Football & 12 Dive Buddies',
      subtitle: 'แยกคลังแฟรนไชส์ดัง, Wordle 14,855 คำ, หมวดฟุตบอลเต็มรูปแบบ, 6 Buddies สายโหด และกระทงลอยวันลอยกระทง',
      stats: [
        { value: '278', label: 'โจทย์ไทย & สากล (139/139)' },
        { value: number(totalAnswers), label: 'คำตอบทั้งหมดในคลัง' },
        { value: '12', label: 'Dive Buddies (คลิกเล่นได้!)' },
      ],
      cards: [
        {
          tag: 'FOOTBALL ⚽',
          tagClass: 'is-gold',
          title: 'เปิด Dive Pack ใหม่: Krillion Football (/unlimited/football)',
          bullets: [
            'รวม <strong>15 โจทย์ฟุตบอลไทยและสากล</strong> ทั้งสโมสรไทยลีก นักเตะทีมชาติไทย สนาม โค้ช-บุคคลสำคัญ พรีเมียร์ลีก และตำนานฟุตบอลโลก',
            'มาพร้อมธีม <strong>สนามฟุตบอลยามค่ำคืน & สปอตไลท์</strong> เฉพาะหมวดฟุตบอล',
          ],
        },
        {
          tag: 'EXPANDED',
          tagClass: 'is-new',
          title: 'แยกคลังแฟรนไชส์ยอดฮิต · เพิ่มชื่อเล่นดาราไทย & คำตกหล่น',
          bullets: [
            'ขยาย <strong>One Piece (918 ตัวละคร)</strong> พร้อมแยกคลังเฉพาะเรื่อง <strong>Naruto</strong>, <strong>Dragon Ball</strong>, <strong>โคนัน</strong>, <strong>โดราเอมอน</strong>, <strong>Star Wars</strong>, <strong>Lord of the Rings</strong>, <strong>Sanrio</strong>, <strong>LoL</strong> และ <strong>Valorant/Overwatch</strong>',
            'เพิ่ม <strong>ชื่อเล่นและคำเรียกคนดังไทย 1,400+ รายการ</strong> (เช่น โดม ปกรลัม, อาไท, โยกเยก) พร้อมตัดวรรณยุกต์/การันต์ที่พิมพ์เกินหน้าคำ และเติม Samarkand, Kenshi, Nadia Comaneci',
          ],
        },
        {
          tag: 'WORDLE & LOOP',
          tagClass: '',
          title: 'ยกเครื่อง Wordle 14,855 คำ & แก้โจทย์ซ้ำ Endless',
          bullets: [
            'รองรับคำศัพท์ภาษาอังกฤษ 5 ตัวอักษรครบชุด <strong>14,855 คำ</strong> ทั้ง MYRRH, PARER, ปรับคำอธิบายช่วง A–M ให้ชัดเจน และเว้นระยะไม่ให้ Wordle ออกติดกัน',
            'แก้ระบบเวียนโจทย์ <strong>Endless</strong> แบบแยกประวัติรายหมวด (FIFO) ให้ดำได้ยาวโดยไม่เจอข้อซ้ำเร็วเกินไป',
          ],
        },
        {
          tag: 'BUDDIES & LOY KRATHONG',
          tagClass: 'is-gold',
          title: '12 Dive Buddies แบบ Interactive & เทศกาลลอยกระทง 🪷',
          bullets: [
            'เพิ่ม 6 Buddy ใหม่ระดับท้าทาย: <strong>Plankton, Too Clever, Axolotl, Narwhal, Sea Dragon</strong> และ <strong>Abyssal Kraken</strong> พร้อมแอนิเมชันว่ายน้ำเฉพาะตัว',
            'คลิกที่ Buddy ได้ทุกเวลา! เพื่อนจะกระโดด หมุนตัว พุ่งตัว ปล่อยฟอง/ประกายดาว และพูดให้กำลังใจตามสายพันธุ์ พร้อม <strong>กระทงลอยแสงเทียน</strong> บนผิวน้ำหน้าแรก',
          ],
        },
      ],
    },
    {
      version: '1.1.0',
      badge: 'Dive Packs',
      headline: 'มีอะไรใหม่ในอัปเดต v1.1.0',
      subtitle: 'เพิ่มโหมดดำน้ำแยกตามหมวดหมู่พร้อมฉากท้องทะเลเฉพาะธีม ขยายเวลาคิดเป็น 30 วินาที เพิ่มโจทย์เฉพาะทางยอดฮิต 20 หมวด และอัปเกรดระบบ Alias ทั้งคลัง',
      stats: [
        { value: number(bank.questions.length), label: 'โจทย์ทั้งหมด (' + (bank.questions.length / 2) + '/' + (bank.questions.length / 2) + ')' },
        { value: '30s', label: 'เวลาคิดต่อข้อ' },
        { value: '5 ธีม', label: 'โหมดดำน้ำแยกหมวด' },
      ],
      cards: [
        {
          tag: 'EXPEDITIONS & ART',
          tagClass: 'is-new',
          title: 'แยกหมวดดำน้ำ 5 ธีม พร้อมงานศิลป์ใต้ทะเลเฉพาะแต่ละหมวด',
          bullets: [
            'เลือกดำน้ำเฉพาะทางได้ในโหมด <strong>Krillion Entertain</strong> (หนัง/อนิเมะ/เพลง/เกม), <strong>Krillion Geography</strong> (ภูมิศาสตร์/ประเทศ/เมือง/วัฒนธรรม), <strong>Krillion Nature &amp; Sci</strong> (ธรรมชาติ/วิทยาศาสตร์/กีฬา) และ <strong>Krillion Food &amp; Daily</strong> (อาหาร/แบรนด์/ของใช้/เล่นคำ)',
            'แต่ละหมวดมาพร้อม<strong>โทนสีน้ำทะเล แสง และฉากใต้น้ำเฉพาะธีม</strong> แต่ยังคงคอนเซ็ปต์การดำน้ำลึกแบบ Krillion เช่นเดิม',
          ],
        },
        {
          tag: 'MASS PROMPTS & TIMER',
          tagClass: 'is-gold',
          title: 'ขยายเวลาคิดเป็น 30 วินาที & เพิ่มโจทย์เฉพาะทางยอดฮิต 20 หมวด',
          bullets: [
            'ปรับเวลาตอบคำถามแต่ละข้อจาก 25 วินาที เป็น <strong>30 วินาที</strong> เพื่อให้นึกคำตอบสายลึกได้ถนัดยิ่งขึ้น',
            'เพิ่มโจทย์เฉพาะทางยอดฮิตอีก <strong>20 หมวด (10 โจทย์ไทย + 10 โจทย์ทั่วไป)</strong> เช่น หมวดตัวละครจากเรื่องดังระดับโลก จักรวาลการ์ตูน เกมฮิต และวรรณคดี/บันเทิงไทย',
          ],
        },
        {
          tag: 'ALIASES & PERFORMANCE',
          tagClass: '',
          title: 'อัปเกรดระบบ Alias ทั้งคลัง & ปรับแต่งประสิทธิภาพความเร็ว',
          bullets: [
            'ปรับปรุงระบบจับคู่ชื่อเรียกอื่น (<strong>Alias</strong>) และคำแก้สะกดให้รองรับชื่อย่อ ชื่อไทย–อังกฤษ คำทับศัพท์ และเครื่องหมายวรรคตอนได้ครอบคลุมกว่าเดิมมาก รวมถึงเติมคำเรียกภาษาไทยให้หมวดสากลนับหมื่นรายการ',
            'ปรับโครงสร้างการตรวจสอบคลัง การสร้างรอบ และการวาดฉากหลังให้ตอบสนองรวดเร็วขึ้นอย่างเห็นได้ชัด ลดอาการหน่วงขณะเริ่มรอบและขณะตรวจคำตอบ',
          ],
        },
      ],
    },
    {
      version: '1.0.13',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.13',
      subtitle: 'เพิ่มโจทย์ใหม่อีก 100 ข้อ ขยายหมวดเดิมขึ้นหลักพันรวม 154 หมวด แชร์ผลเป็นรูปการ์ดสวยงาม และเพิ่มฉากใต้ทะเลลึกตามระดับความลึก',
      stats: [
        { value: number(bank.questions.length), label: 'โจทย์ไทย & ทั่วไป (118/118)' },
        { value: number(totalAnswers), label: 'คำตอบทั้งหมดในคลัง' },
        { value: number(megaCount), label: 'หมวดใหญ่ 1,000+ คำ' },
      ],
      cards: [
        {
          tag: 'CONSOLIDATED',
          tagClass: 'is-new',
          title: 'เพิ่มโจทย์ใหม่อีก 100 ข้อ (50 โจทย์ไทย + 50 โจทย์ทั่วไป)',
          bullets: [
            'เพิ่มโจทย์ไทยใหม่ 50 ข้อ และโจทย์ทั่วไปใหม่ 50 ข้อ ตามแนวทางการออกแบบโจทย์ของเกมต้นแบบ รักษาสัดส่วนโจทย์ไทย–ทั่วไปให้สมดุล (รวม <strong>236 โจทย์ 118/118</strong>)',
            'โจทย์ใหม่ทั้งหมดมาพร้อมคลังคำตอบระดับ <strong>1,000+ รายการต่อข้อ</strong> ครอบคลุมหลากหลายหมวดหมู่พร้อมจัดลำดับความคุ้นเคยอย่างสมดุล',
          ],
        },
        {
          tag: 'EXPANDED',
          tagClass: 'is-gold',
          title: 'อัปเกรดหมวดเดิมจากหลักร้อยขึ้นสู่ระดับ 1,000+ คำตอบ รวม 154 หมวด',
          bullets: [
            'ขยายคลังคำตอบของโจทย์เดิมที่เคยมีคำตอบระดับ 100–900 รายการ ให้ทะลุ <strong>1,000+ คำตอบต่อข้อเพิ่มขึ้นอีกกว่า 24 หมวด</strong>',
            'รวมทั้งคลังมีหมวดใหญ่ระดับ <strong>1,000+ คำตอบถึง 154 หมวด</strong> (และระดับ <strong>10,000+ คำตอบ 16 หมวด</strong>) รวมคำตอบทั้งคลังเกือบสี่แสนรายการ',
          ],
        },
        {
          tag: 'SHARE CARD & VISUALS',
          tagClass: '',
          title: 'บันทึกและคัดลอกผลเป็นรูปการ์ด PNG & ดำลึกยิ่งเจอสิ่งมีชีวิตใต้ทะเลมากขึ้น',
          bullets: [
            'อัปเกรดปุ่มแชร์ผลหลังจบเกมเป็น <strong>Share Card Studio</strong> สร้างการ์ดรูปภาพสรุปผลความละเอียดสูง บันทึกเป็นไฟล์ <strong>.PNG</strong> หรือกดคัดลอกรูปภาพไปวางแชร์ได้ทันที (เลือกเปิด/ปิดการแสดงคำตอบเพื่อกันสปอยล์ได้)',
            'เพิ่มฉากและสิ่งมีชีวิตใต้ทะเลตามระดับความลึก ยิ่งดำดิ่งลึกยิ่งพบสิ่งใหม่ ทั้งแนวสาหร่าย ฝูงปลาเรืองแสง พญานาคทะเล หมึกดัมโบ ซากเรือจม ปล่องน้ำร้อนใต้สมุทร และออโรราฝูงเคยทองคำในร่องลึก',
            'ปรับปรุงระบบสุ่มโจทย์ให้กระจายครบ 7 หมวดไม่ซ้ำกันในแต่ละรอบ พร้อมระบบเว้นระยะตระกูลโจทย์ต่อเนื่อง ไม่เจอโจทย์แนวเดิมซ้ำถี่เมื่อเล่นต่อเนื่องหลายรอบ',
          ],
        },
      ],
    },
    {
      version: '1.0.12',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.12',
      subtitle: 'กด Enter เพื่อไปข้อถัดไปได้ทันที อัปเกรดระบบ Auto-Correct ให้ฉลาดขึ้น และเติมคำตอบพร้อมชื่อเรียกอื่นในคลัง',
      stats: [
        { value: '136', label: 'โจทย์ไทย & ทั่วไป (68/68)' },
        { value: '233,738', label: 'คำตอบทั้งหมดในคลัง' },
        { value: '30', label: 'หมวดใหญ่ 1,000+ คำ' },
      ],
      cards: [
        {
          tag: 'CONTROLS & AUTO-CORRECT',
          tagClass: 'is-new',
          title: 'กด Enter ไปข้อถัดไปได้ทันที & ระบบเดาคำสะกดใกล้เคียงแม่นยำขึ้น',
          bullets: [
            'เมื่อเฉลยคำตอบในแต่ละข้อแล้ว สามารถกดปุ่ม <strong>Enter ↵</strong> บนคีย์บอร์ดเพื่อดำดิ่งสู่ข้อถัดไป (หรือยืนยันคำแก้) ได้ทันทีโดยไม่ต้องคลิกเมาส์',
            'อัปเกรดระบบ <strong>Auto-Correct</strong> ให้เข้าใจทั้งการพิมพ์ตกคำนำหน้า/พหูพจน์ภาษาอังกฤษ การสะกดคำทับศัพท์ และการพ้องเสียงพยัญชนะหรือวรรณยุกต์ภาษาไทยได้แม่นยำยิ่งขึ้น',
          ],
        },
        {
          tag: 'EXPANDED',
          tagClass: 'is-gold',
          title: 'เติมคำตอบใหม่และชื่อเรียกพ้องเพิ่มเติมในคลังคำถาม',
          bullets: [
            'เพิ่มคำตอบหลักใหม่และปรับระดับคะแนนความคุ้นเคยในหลายหมวดจากข้อมูลที่ผู้เล่นเสนอและตอบเข้ามาจริง',
            'เพิ่มชื่อเรียกย่อ ชื่อเล่น และรูปแบบตัวสะกดยอดนิยมในคลังคำตอบเพื่อให้ตรวจรับคำตอบได้ครอบคลุมและลื่นไหลยิ่งขึ้น',
          ],
        },
      ],
    },
    {
      version: '1.0.11',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.11',
      subtitle: 'เพิ่มโจทย์ใหม่และอัปเกรดหมวดเดิมสู่ระดับ 10,000+ คำตอบในกลุ่มสื่อ บันเทิง ผู้คน และกลุ่มสิ่งมีชีวิตและวิทยาศาสตร์',
      stats: [
        { value: '136', label: 'โจทย์ไทย & ทั่วไป (68/68)' },
        { value: '233,728', label: 'คำตอบทั้งหมดในคลัง' },
        { value: '30', label: 'หมวดใหญ่ 1,000+ คำ' },
      ],
      cards: [
        {
          tag: 'CONSOLIDATED',
          tagClass: 'is-new',
          title: 'เพิ่มโจทย์ใหม่ระดับ 10,000+ คำตอบในกลุ่มสื่อ บันเทิง ผู้คน และสิ่งมีชีวิต',
          bullets: [
            'เพิ่มโจทย์ไทยใหม่ 2 ข้อ และโจทย์ทั่วไปใหม่ 2 ข้อ ในกลุ่มสื่อ บันเทิง และผู้คน รวมถึงกลุ่มสิ่งมีชีวิตและวิทยาศาสตร์ รักษาสัดส่วนโจทย์ไทย–ทั่วไปให้สมดุล (รวม <strong>136 โจทย์ 68/68</strong>)',
            'โจทย์ใหม่ทุกข้อจัดเต็มคลังคำตอบระดับ <strong>10,000+ รายการต่อข้อ</strong> พร้อมจัดลำดับความคุ้นเคยตั้งแต่ระดับพื้นฐานไปจนถึงระดับหายาก',
          ],
        },
        {
          tag: 'EXPANDED',
          tagClass: 'is-gold',
          title: 'อัปเกรดคลังคำตอบหมวดเดิมสู่ระดับ 10,000+ คำตอบรวม 16 หมวด',
          bullets: [
            'ขยายคลังคำตอบของโจทย์เดิมในกลุ่มสื่อ บันเทิง และผู้คน (5 หมวด) และกลุ่มสิ่งมีชีวิตและธรรมชาติ (2 หมวด) ให้รองรับคำตอบมากกว่า <strong>10,000+ รายการต่อข้อ</strong>',
            'รวมทั้งคลังมีหมวดระดับ <strong>10,000+ คำตอบถึง 16 หมวด</strong> และหมวดใหญ่ <strong>1,000+ คำตอบรวม 30 หมวด</strong> ครอบคลุมคำตอบรวมกว่าสองแสนรายการ',
          ],
        },
      ],
    },
    {
      version: '1.0.10',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.10',
      subtitle: 'ขยายคลังหมวดใหญ่ระดับ 1,000+ และ 10,000+ คำตอบ เพิ่มโจทย์ใหม่ ปรับสมดุลคลังเดิม และอัปเกรดภาพฉากหลังใต้ทะเล',
      stats: [
        { value: '132', label: 'โจทย์ไทย & ทั่วไป (66/66)' },
        { value: '128,750', label: 'คำตอบทั้งหมดในคลัง' },
        { value: '25', label: 'หมวดใหญ่ 1,000+ คำ' },
      ],
      cards: [
        {
          tag: 'VISUALS',
          tagClass: 'is-new',
          title: 'ฉากหลังใต้ทะเลตื่นตาตื่นใจและตอบสนองตามความลึกยิ่งขึ้น',
          bullets: [
            'เพิ่มสิ่งมีชีวิตและแสงสีตามระดับความลึกตลอดการดำน้ำ ทั้งแสงผิวน้ำ ฝูงปลา สัตว์ทะเลลึก และสันร่องสมุทร',
            'เพิ่มเส้นแรงดันน้ำและคลื่นแสงสะท้อนระหว่างดำดิ่งตอบคำถาม โดยเอฟเฟกต์จะเด่นชัดขึ้นตามระดับคะแนนของคำตอบ',
          ],
        },
        {
          tag: 'CONSOLIDATED',
          tagClass: 'is-gold',
          title: 'ปรับสมดุลโครงสร้างโจทย์ & เพิ่มหมวดใหญ่ระดับ 1,000+ และ 10,000+ คำตอบ',
          bullets: [
            'ปรับปรุงและรวมโจทย์กลุ่มใกล้เคียงเข้าด้วยกันเป็นข้อเดียว พร้อมเพิ่มโจทย์ใหม่รักษาสัดส่วนไทย–ทั่วไปให้สมดุล (รวม <strong>132 โจทย์ 66/66</strong>)',
            'ขยายคลังสู่ระดับ <strong>10,000+ คำตอบต่อข้อถึง 5 หมวด</strong> และมีหมวดใหญ่ <strong>1,000+ คำตอบรวม 25 หมวด</strong> (ครอบคลุมคำตอบกว่าแสนรายการทั้งคลัง)',
          ],
        },
        {
          tag: 'EXPANDED',
          tagClass: '',
          title: 'เติมคำตอบใหม่และปรับระดับคะแนนความหายากในหลายหมวด',
          bullets: [
            'เพิ่มคำตอบใหม่ที่ผู้เล่นนิยมตอบแต่ยังขาดในคลังเดิม พร้อมปรับระดับคะแนนความหายากให้สะท้อนความคุ้นเคยจริงยิ่งขึ้น',
            'เพิ่มชื่อเรียกอื่น ตัวสะกดยอดนิยม และชื่อย่อในคลังคำตอบหลายหมวดเพื่อให้ระบบตรวจคำตอบแม่นยำและลื่นไหลขึ้น',
          ],
        },
      ],
    },
    {
      version: '1.0.9',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.9',
      subtitle: 'เพิ่มโจทย์ใหม่อีก 20 หมวด (รวม 120 โจทย์) ปรับสมดุลความหายากใหม่ทั้งคลัง และอ่านย้อนหลังได้',
      stats: [
        { value: number(bank.questions.length), label: 'โจทย์ไทย & ทั่วไป (60/60)' },
        { value: number(totalAnswers), label: 'คำตอบทั้งหมดในคลัง' },
        { value: number(megaCount), label: 'หมวดใหญ่ 1,000+ คำ' },
      ],
      cards: [
        {
          tag: 'NEW',
          tagClass: 'is-new',
          title: 'เพิ่มโจทย์ใหม่อีก 20 หมวด (60 โจทย์ไทย + 60 โจทย์ทั่วไป)',
          bullets: [
            '<strong>10 โจทย์ไทยใหม่:</strong> สุภาษิต/สำนวนไทย, ผีไทยและตำนานพื้นบ้าน, วรรณคดีไทย, ต้นไม้ในไทย, มื้อเช้าในไทย, ร้านอาหารและคาเฟ่ในไทย, ถนนในกรุงเทพฯ, แม่น้ำ/ลำคลองในไทย, มหาวิทยาลัยในไทย และคลังเพลงไทย (936 เพลง)',
            '<strong>10 โจทย์ทั่วไปใหม่:</strong> แลนด์มาร์กโลก, บุคคลสำคัญในประวัติศาสตร์, เทพเจ้าและสัตว์ในตำนาน, แบรนด์แฟชั่น, อัญมณีและแร่, เครื่องเขียน, ปรากฏการณ์ธรรมชาติ, อวัยวะร่างกาย, หนังสือ/นิยายระดับโลก และเพลงสากล',
          ],
        },
        {
          tag: 'BALANCED',
          tagClass: 'is-gold',
          title: 'ปรับสมดุลความยาก & ระดับ Krillion (100 PTS) ทั้งคลัง',
          bullets: [
            'จัดลำดับความคุ้นเคยใหม่จากความนิยมจริงแทนการเรียงตัวอักษร แก้ไขคำตอบที่คนรู้จักดีที่เคยหลุดไปอยู่ระดับลึก (เช่น <strong>เทควันโด, สตรอว์เบอร์รี, โบ สุนิตา, เกาะเกร็ด, ปีบ, ประดู่, ทีรามิสุ, Steam Deck, กีตาร์โปร่ง</strong>) ให้ได้คะแนนตามความคุ้นเคยจริง',
            'กระชับสัดส่วนระดับ <strong>1 in Krillion</strong> ให้เหลือเฉพาะคำตอบสายลึกจริง ๆ (ไม่เกิน ~9% ต่อหมวด จากเดิมบางหมวดสูงกว่า 30–40%) เพื่อให้การเก็บแต้มเต็มท้าทายและสมดุลขึ้น',
          ],
        },
        {
          tag: 'UI',
          tagClass: '',
          title: 'เปิดอ่าน Patch Notes ย้อนหลังได้ทุกเวอร์ชัน',
          bullets: [
            'เพิ่มแถบสลับเวอร์ชันด้านบนหน้าต่าง <strong>Patch Notes</strong> สำหรับย้อนดูรายการปรับปรุงคอนเทนต์ตั้งแต่เวอร์ชันก่อนหน้าได้ทุกเมื่อ',
          ],
        },
      ],
    },
    {
      version: '1.0.8',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.8',
      subtitle: 'อัปเกรดหน้าต่างเสนอคำตอบหลังจบเกมให้ใช้งานง่ายขึ้นแบบการ์ดติดแท็กทีละข้อ',
      stats: [
        { value: '100', label: 'โจทย์ไทย & ทั่วไป (50/50)' },
        { value: '40,708', label: 'คำตอบทั้งหมดในคลัง' },
        { value: '12', label: 'หมวดใหญ่ 1,000+ คำ' },
      ],
      cards: [
        {
          tag: 'SURVEY',
          tagClass: 'is-new',
          title: 'Survey เสนอคำตอบเพิ่มแบบการ์ดติดแท็กทีละข้อ',
          bullets: [
            'จบเกม 7 ข้อแล้วแสดงครบทุกข้อในหน้าเดียว พิมพ์คำตอบที่อยากให้มีแล้วกด <strong>Enter</strong> เพื่อติดแท็กเป็นแบดจ์ได้ทันที',
            'มีชิปคำตอบที่พิมพ์ไม่ผ่านด่านในรอบนั้นให้กดเลือกเสนอเข้าคลังได้ไวขึ้น พร้อมโควตาส่งต่อครั้งที่ชัดเจน',
          ],
        },
        {
          tag: 'UI',
          tagClass: '',
          title: 'หน้าต่าง Patch Notes ก่อนเข้าเล่น',
          bullets: [
            'แสดงสรุปการอัปเดตคอนเทนต์อัตโนมัติเมื่อเข้าเกมครั้งแรกของเวอร์ชันใหม่ พร้อมปุ่มเปิดดูได้จากหน้าแรก',
          ],
        },
      ],
    },
    {
      version: '1.0.7',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.7',
      subtitle: 'ยกเครื่องคลังคำถามและคำตอบครั้งใหญ่เป็น 100 โจทย์ กว่า 40,000 คำตอบ',
      stats: [
        { value: '100', label: 'โจทย์ไทย & ทั่วไป (50/50)' },
        { value: '40,708', label: 'คำตอบทั้งหมดในคลัง' },
        { value: '12', label: 'หมวดใหญ่ 1,000+ คำ' },
      ],
      cards: [
        {
          tag: 'NEW',
          tagClass: 'is-new',
          title: 'เพิ่มโจทย์ใหม่ & ขยายหมวดบันเทิงทะลุพันคำตอบ',
          bullets: [
            'แยกโจทย์ <strong>อนิเมะญี่ปุ่น (2,735 เรื่อง)</strong> และเพิ่ม <strong>ละครไทย/ซีรีส์ไทย (1,705+ เรื่อง)</strong>',
            'ขยายหมวดยอดฮิตทะลุพันคำตอบ ทั้งซีรีส์ต่างประเทศ หนังต่างประเทศ หนังไทย ศิลปินต่างประเทศ นักร้องเดี่ยวไทย วิดีโอเกม เมืองดังทั่วโลก ตัวการ์ตูน และแอนิเมชัน',
          ],
        },
        {
          tag: 'EXPANDED',
          tagClass: 'is-gold',
          title: 'จัดเต็มอาหารอีสาน & หมวดรอบตัว 100+ คำตอบ',
          bullets: [
            'ขยายหมวด <strong>อาหารอีสาน</strong> เป็น <strong>273 เมนู</strong> ครบทั้งส้มตำ ลาบ ก้อย ซอยจุ๊ อู๋เพี้ย หมก แกงอ่อม ป่น แจ่วบอง ฯลฯ',
            'ขยายหมวดสัตว์รอบโลก (1,257 ชนิด) และสัตว์รอบบ้านไทย (เพิ่ม จิ้งจก ตุ๊กแก ตัวเงินตัวทอง) พร้อมขยายหมวดปลายเปิดให้เกิน 100 คำตอบแทบทุกข้อ',
          ],
        },
      ],
    },
    {
      version: '1.0.6',
      badge: '',
      headline: 'มีอะไรใหม่ในอัปเดต v1.0.6',
      subtitle: 'ปรับโทนคำถามและเติมคำตอบที่คนไทยนึกออกได้จริง',
      stats: [
        { value: '60', label: 'โจทย์ไทย & ทั่วไป' },
        { value: '30 Thai', label: 'โจทย์บริบทไทย' },
        { value: '30 World', label: 'โจทย์สากล' },
      ],
      cards: [
        {
          tag: 'REFINED',
          tagClass: '',
          title: 'คัดโจทย์ที่เฉพาะทางเกินไปออก & เติมคำตอบใกล้ตัว',
          bullets: [
            'ตัดโจทย์สายวิชาการหรือเจาะจงพื้นที่เกินไป (เช่น โจทย์ผีเสื้อเฉพาะถิ่น) เหลือเฉพาะโจทย์ใกล้ตัวที่เล่นสนุก',
            'เพิ่มชื่อสัตว์รอบตัวและอาหารไทยที่คนนึกออกทันทีแต่ขาดไปในชุดก่อนหน้า',
          ],
        },
      ],
    },
    {
      version: '1.0.5',
      badge: '',
      headline: 'เปิดตัวรุ่นแรก v1.0.5',
      subtitle: 'เกมดำน้ำตอบคำถาม 5 ระดับความลึก พร้อมระบบตรวจคำตอบไทย–อังกฤษ',
      stats: [
        { value: '5 Tiers', label: 'Plankton → Krillion' },
        { value: '2 Modes', label: 'Daily & Endless' },
        { value: 'TH / EN', label: 'รองรับสองภาษา' },
      ],
      cards: [
        {
          tag: 'LAUNCH',
          tagClass: 'is-gold',
          title: 'ระบบการเล่นหลักครบชุด',
          bullets: [
            'เปิดเล่นโหมด <strong>Daily Dive (7 ข้อประจำวัน)</strong> และ <strong>Endless Dive (ดำน้ำต่อเนื่องไม่จำกัดรอบ)</strong>',
            'รองรับคำตอบทั้งภาษาไทย อังกฤษ ชื่อย่อ และการแก้คำสะกดคลาดเคลื่อนเล็กน้อย',
          ],
        },
      ],
    },
  ];
}
function patchNotesDialog(selectedVer = APP_VERSION) {
  const totalAnswers = bank.questions.reduce((sum, q) => sum + q.answers.length, 0);
  const megaCount = bank.questions.filter(q => q.answers.length >= 1000).length;
  const history = getPatchHistory(totalAnswers, megaCount);
  const renderTabs = curVer => history.map(entry =>
    '<button type="button" role="tab" aria-selected="' + (entry.version === curVer) + '" class="patch-tab' + (entry.version === curVer ? ' is-active' : '') + '" data-patch-ver="' + esc(entry.version) + '">v' + esc(entry.version) + (entry.badge ? ' · ' + esc(entry.badge) : '') + '</button>'
  ).join('');
  const renderEntryBody = entry =>
    '<div class="patch-stats">' + entry.stats.map(st =>
      '<div class="patch-stat"><strong>' + esc(st.value) + '</strong><span>' + esc(st.label) + '</span></div>'
    ).join('') + '</div>' +
    '<div class="patch-list">' + entry.cards.map(c =>
      '<article class="patch-card"><div class="patch-card-head"><span class="patch-tag' + (c.tagClass ? ' ' + c.tagClass : '') + '">' + esc(c.tag) + '</span> ' + esc(c.title) + '</div><ul>' +
      c.bullets.map(b => '<li>' + b + '</li>').join('') +
      '</ul></article>'
    ).join('') + '</div>';

  const active = history.find(h => h.version === selectedVer) || history[0];
  openModal('patchnotes', 'Patch Notes v' + active.version,
    '<header class="modal-hero">' +
      '<div class="modal-eyebrow">PATCH NOTES <span class="version-pill" id="patch-hero-pill">v' + esc(active.version) + '</span></div>' +
      '<h3 id="patch-hero-title">' + esc(active.headline) + '</h3>' +
      '<p id="patch-hero-sub">' + esc(active.subtitle) + '</p>' +
    '</header>' +
    '<div class="patch-tabs" role="tablist" aria-label="ประวัติเวอร์ชัน Patch Notes">' + renderTabs(active.version) + '</div>' +
    '<div class="patch-scroll" id="patch-scroll-body">' + renderEntryBody(active) + '</div>' +
    '<footer class="patch-footer"><button type="button" class="primary-button survey-submit" data-action="close">เข้าใจแล้ว ลุยดำน้ำเลย →</button></footer>');

  const tabsEl = modalRoot.querySelector('.patch-tabs');
  const scrollBody = modalRoot.querySelector('#patch-scroll-body');
  const heroPill = modalRoot.querySelector('#patch-hero-pill');
  const heroTitle = modalRoot.querySelector('#patch-hero-title');
  const heroSub = modalRoot.querySelector('#patch-hero-sub');
  const dlgTitle = modalRoot.querySelector('#dialog-title');
  tabsEl?.addEventListener('click', e => {
    const btn = e.target.closest('[data-patch-ver]');
    if (!btn) return;
    const next = history.find(h => h.version === btn.dataset.patchVer);
    if (!next) return;
    if (heroPill) heroPill.textContent = 'v' + next.version;
    if (heroTitle) heroTitle.textContent = next.headline;
    if (heroSub) heroSub.textContent = next.subtitle;
    if (dlgTitle) dlgTitle.textContent = 'Patch Notes v' + next.version;
    tabsEl.innerHTML = renderTabs(next.version);
    if (scrollBody) {
      scrollBody.innerHTML = renderEntryBody(next);
      scrollBody.scrollTop = 0;
    }
  });
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
function depthZoneLabel(depth) {
  if (depth >= 5200) return 'HADAL KRILLION TRENCH';
  if (depth >= 3000) return 'THE ABYSSAL ZONE';
  if (depth >= 1000) return 'THE MIDNIGHT ZONE';
  if (depth >= 200) return 'THE TWILIGHT ZONE';
  return 'THE SUNLIGHT ZONE';
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderShareCardCanvas(canvas, targetSession, showAnswers = false) {
  if (!canvas || !targetSession) return;
  const W = 960, H = 1220;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 1. Deep Ocean Gradient Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#134e6f');
  bg.addColorStop(0.28, '#0b2d48');
  bg.addColorStop(0.65, '#06182c');
  bg.addColorStop(1, '#030a14');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 2. Top Sunlight Caustic Beams
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(110 + i * 195, -20);
    ctx.rotate(-0.18 + i * 0.05);
    const ray = ctx.createLinearGradient(-70, 0, 70, 520);
    ray.addColorStop(0, 'rgba(155,235,250,0.16)');
    ray.addColorStop(0.6, 'rgba(75,222,244,0.04)');
    ray.addColorStop(1, 'rgba(75,222,244,0)');
    ctx.fillStyle = ray;
    ctx.fillRect(-70, 0, 140, 520);
    ctx.restore();
  }

  // 3. Bioluminescent Radial Aura & Spores
  const gems = targetSession.results.filter(r => r.tier === 'krillion').length;
  const aura = ctx.createRadialGradient(W * 0.5, 310, 20, W * 0.5, 310, 440);
  aura.addColorStop(0, gems > 0 ? 'rgba(255,227,135,0.20)' : 'rgba(75,222,244,0.18)');
  aura.addColorStop(0.55, 'rgba(245,83,136,0.07)');
  aura.addColorStop(1, 'rgba(6,24,44,0)');
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, W, H);

  const sporeColors = ['#4bdef4', '#7af3d8', '#f55388', '#ffe387'];
  for (let i = 0; i < 64; i++) {
    const sx = ((i * 173 + 47) % (W - 60)) + 30;
    const sy = ((i * 229 + 83) % (H - 60)) + 30;
    const sr = (i % 4 === 0) ? 2.6 : 1.6;
    ctx.fillStyle = sporeColors[i % sporeColors.length];
    ctx.globalAlpha = 0.18 + (i % 5) * 0.08;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Sonar rings around hero depth
  for (let r = 1; r <= 3; r++) {
    ctx.strokeStyle = gems > 0 ? `rgba(255,227,135,${0.14 - r * 0.03})` : `rgba(75,222,244,${0.14 - r * 0.03})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(W * 0.5, 285, 85 + r * 58, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Outer Frame Border
  ctx.strokeStyle = 'rgba(122,220,255,0.22)';
  ctx.lineWidth = 2;
  drawRoundedRect(ctx, 24, 24, W - 48, H - 48, 22);
  ctx.stroke();

  // 4. Header & Dive Subtitle
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8ecae6';
  ctx.font = '600 22px VT323, monospace';
  const grpInfo = targetSession.mode === 'endless' ? getDiveGroup(targetSession.group || 'classic') : null;
  const modeLabel = targetSession.mode === 'daily'
    ? `KRILLION TH · DAILY DIVE · ${targetSession.date}`
    : (grpInfo && grpInfo.id !== 'classic'
      ? `KRILLION TH · ${grpInfo.title} #${targetSession.run} · ${targetSession.date}`
      : `KRILLION TH · ENDLESS DIVE #${targetSession.run} · ${targetSession.date}`);
  ctx.fillText(modeLabel, W * 0.5, 76);

  const title = targetSession.score === 700
    ? 'THE PERFECT DIVE'
    : targetSession.score >= 450
      ? 'INTO THE ABYSS'
      : targetSession.score >= 250
        ? 'A DEEPER KIND OF KNOWLEDGE'
        : 'BACK AT THE SURFACE';
  ctx.fillStyle = '#e8f7ff';
  ctx.font = '700 54px VT323, monospace';
  ctx.fillText(title, W * 0.5, 132);

  // Depth Zone Pill
  const zoneText = depthZoneLabel(targetSession.depth);
  ctx.font = '600 20px VT323, monospace';
  const zW = Math.max(240, ctx.measureText(zoneText).width + 44);
  ctx.fillStyle = 'rgba(12,48,74,0.85)';
  ctx.strokeStyle = 'rgba(75,222,244,0.45)';
  ctx.lineWidth = 1.5;
  drawRoundedRect(ctx, (W - zW) * 0.5, 152, zW, 34, 17);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#6cdcff';
  ctx.fillText(zoneText, W * 0.5, 176);

  // 5. Giant Depth Number & Score Summary
  ctx.fillStyle = gems > 0 ? '#ffe387' : '#7af3d8';
  ctx.font = '700 132px VT323, monospace';
  ctx.fillText(`${number(targetSession.depth)}m`, W * 0.5, 298);

  ctx.fillStyle = '#c5e4f3';
  ctx.font = '600 28px VT323, monospace';
  ctx.fillText(`${targetSession.score} / 700 POINTS  ·  ${gems} KRILLION${gems === 1 ? '' : 'S'} 🌟`, W * 0.5, 345);

  // Draw Buddy Sprite if available
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise(resolve => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = sprite(save.character || 'krillion');
    });
    if (img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, W * 0.5 + 215, 205, 84, 84);
      ctx.restore();
    }
  } catch {}

  // 6. 7-Column Visual Score Bar Graph
  const graphTop = 382, graphH = 148, colW = 74, gap = 22;
  const totalGraphW = 7 * colW + 6 * gap;
  const startX = (W - totalGraphW) * 0.5;

  drawRoundedRect(ctx, 56, graphTop - 16, W - 112, graphH + 68, 16);
  ctx.fillStyle = 'rgba(5,20,36,0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(122,220,255,0.16)';
  ctx.stroke();

  targetSession.results.forEach((r, i) => {
    const x = startX + i * (colW + gap);
    const colColor = r.tier ? tierColor(r.tier) : '#3b4e63';
    // Track background
    drawRoundedRect(ctx, x, graphTop + 22, colW, graphH - 18, 10);
    ctx.fillStyle = 'rgba(18,45,68,0.65)';
    ctx.fill();

    // Filled bar proportional to points (min 12px)
    const barH = Math.max(12, Math.round(((r.points || 4) / 100) * (graphH - 18)));
    const barY = graphTop + 22 + (graphH - 18 - barH);
    drawRoundedRect(ctx, x, barY, colW, barH, 10);
    ctx.fillStyle = colColor;
    ctx.fill();

    // Points label above bar
    ctx.fillStyle = colColor;
    ctx.font = '700 22px VT323, monospace';
    ctx.fillText(r.points ? `+${r.points}` : 'MISS', x + colW * 0.5, graphTop + 14);

    // Round index below bar
    ctx.fillStyle = '#9bbbd0';
    ctx.font = '600 20px VT323, monospace';
    ctx.fillText(`#${i + 1}`, x + colW * 0.5, graphTop + graphH + 28);
  });

  // 7. 7-Round Breakdown List (Spoiler-Free by default, or with answers when toggled)
  const listTop = 586, rowH = 74, rowGap = 10;
  targetSession.results.forEach((r, i) => {
    const ry = listTop + i * (rowH + rowGap);
    const colColor = r.tier ? tierColor(r.tier) : '#60788e';
    const tierName = r.tier ? TIERS[r.tier].name.toUpperCase() : (r.reason === 'timeout' ? 'OUT OF TIME' : 'SKIPPED');
    const emoji = r.tier ? TIERS[r.tier].emoji : '⬛';

    drawRoundedRect(ctx, 56, ry, W - 112, rowH, 13);
    ctx.fillStyle = 'rgba(8,28,48,0.82)';
    ctx.fill();
    ctx.strokeStyle = r.tier === 'krillion' ? 'rgba(255,227,135,0.45)' : 'rgba(122,220,255,0.14)';
    ctx.lineWidth = 1.3;
    ctx.stroke();

    // Left accent bar
    drawRoundedRect(ctx, 56, ry, 8, rowH, 4);
    ctx.fillStyle = colColor;
    ctx.fill();

    // Round number & prompt
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7fa6c0';
    ctx.font = '600 17px Sarabun, sans-serif';
    const promptStr = String(r.prompt || '').length > 54 ? String(r.prompt).slice(0, 52) + '…' : String(r.prompt || '');
    ctx.fillText(`${i + 1}. ${promptStr}`, 82, ry + 28);

    // Answer or Spoiler-Free Tier description
    ctx.fillStyle = '#eaf7ff';
    ctx.font = '700 21px Sarabun, sans-serif';
    const mainLine = showAnswers
      ? (r.label ? `“${r.label}”` : (r.reason === 'timeout' ? 'หมดเวลา' : 'ข้ามข้อ'))
      : `${emoji} ${tierName} · จมลึก +${number((r.points || 0) * 10)}m`;
    ctx.fillText(mainLine, 82, ry + 57);

    // Right score badge
    ctx.textAlign = 'right';
    ctx.fillStyle = colColor;
    ctx.font = '700 32px VT323, monospace';
    ctx.fillText(`${r.points} PTS`, W - 78, ry + 38);
    ctx.font = '600 17px VT323, monospace';
    ctx.fillText(tierName, W - 78, ry + 59);
  });

  // 8. Footer Branding
  ctx.textAlign = 'center';
  ctx.fillStyle = '#739ab4';
  ctx.font = '600 21px VT323, monospace';
  ctx.fillText(`1 IN A KRILLION TH  ·  1inkrillionth.vercel.app  ·  v${APP_VERSION}`, W * 0.5, H - 38);
}

async function copyResult() {
  if (!session) return;
  const text = shareText(session, save.settings.shareLink, location.origin);
  openModal(
    'share',
    'Share your dive',
    '<div class="share-studio">' +
      '<div class="share-canvas-wrap"><canvas id="share-card-canvas" width="960" height="1220"></canvas></div>' +
      '<label class="share-spoiler-toggle"><input type="checkbox" id="share-show-answers"> ' +
        '<span>แสดงคำตอบของฉันบนรูปภาพ <small>(ปิดไว้หากไม่อยากสปอยล์เพื่อน)</small></span></label>' +
      '<div class="share-studio-actions">' +
        '<button type="button" class="primary-button is-gold-btn" id="btn-save-image">⬇ SAVE IMAGE (.PNG)</button>' +
        '<button type="button" class="primary-button" id="btn-copy-image">⧉ COPY IMAGE</button>' +
        '<button type="button" class="primary-button" id="btn-copy-text">↗ COPY TEXT</button>' +
      '</div>' +
      '<details class="share-text-details"><summary>ดูข้อความสำหรับแชร์</summary><pre class="share-text">' + esc(text) + '</pre></details>' +
    '</div>'
  );

  const canvas = document.getElementById('share-card-canvas');
  const toggle = document.getElementById('share-show-answers');
  const btnSave = document.getElementById('btn-save-image');
  const btnCopyImg = document.getElementById('btn-copy-image');
  const btnCopyTxt = document.getElementById('btn-copy-text');

  await document.fonts?.ready;
  await renderShareCardCanvas(canvas, session, false);

  toggle?.addEventListener('change', () => {
    renderShareCardCanvas(canvas, session, Boolean(toggle.checked));
  });

  const toBlob = () => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

  btnSave?.addEventListener('click', async () => {
    const blob = await toBlob();
    if (!blob) return;
    const filename = `krillion-th-${session.mode}-${session.date}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('บันทึกรูปภาพผลการดำน้ำแล้ว');
    audio?.play('spare');
  });

  btnCopyImg?.addEventListener('click', async () => {
    try {
      const blob = await toBlob();
      if (!blob || typeof ClipboardItem === 'undefined') throw new Error('ClipboardItem unsupported');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('คัดลอกรูปภาพลงคลิปบอร์ดแล้ว กดวาง (Ctrl+V) ได้เลย!');
      audio?.play('spare');
    } catch {
      btnSave?.click();
    }
  });

  btnCopyTxt?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('คัดลอกข้อความผลการดำน้ำแล้ว');
      audio?.play('spare');
    } catch {
      toast('เลือกข้อความด้านล่างเพื่อคัดลอกได้เลย');
    }
  });
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
    const { questions, ...rest } = selected;
    session = { ...structuredClone(rest), questions };
    closeModal(); view = 'history-result'; render(); window.scrollTo({top:0,behavior:'instant'}); return;
  }
  const resumeItem=event.target.closest('[data-resume]');
  if(resumeItem) {
    const old=savedSessions(save).find(s=>s.id===resumeItem.dataset.resume&&surveySession(s));
    if(!old)return;
    const { questions, ...rest } = old;
    session=tickSession({ ...structuredClone(rest), questions });
    mode=session.mode;
    activeGroup = session.mode === 'endless' ? (session.group || 'classic') : 'classic';
    view='play';save.resumeSessionId=session.id;
    history.pushState({},'',mode==='daily'?'/':getDiveGroup(activeGroup).route);
    closeModal();schedulePrewarm(session);persist();render();window.scrollTo({top:0,behavior:'instant'});return;
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
    case 'daily': changeMode('daily', 'classic'); break;
    case 'endless': changeMode('endless', activeGroup); break;
    case 'endless-group': changeMode('endless', button.dataset.group || 'classic'); break;
    case 'home': closeModal(); save.resumeSessionId=null;persist();view = 'home'; session = null; scene?.setGroupTheme?.(currentSceneGroup()); render(); window.scrollTo({top:0,behavior:'instant'}); break;
    case 'begin': startDive(); break;
    case 'new-endless': changeMode('endless', session?.group || activeGroup); startDive(true); break;
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
    case 'blub': {
      const buddyId = button.dataset.buddy || save.character || 'krillion';
      const lines = BUDDY_LINES[buddyId] || BUDDY_LINES.krillion;
      const lineIdx = ((Number(button.dataset.lineIdx || -1) + 1) % lines.length);
      const animIdx = ((Number(button.dataset.animIdx || -1) + 1) % BUDDY_REACTIONS.length);
      button.dataset.lineIdx = String(lineIdx);
      button.dataset.animIdx = String(animIdx);
      button.dataset.say = lines[lineIdx];
      button.classList.remove('blub', ...BUDDY_REACTIONS);
      void button.offsetWidth;
      button.classList.add('blub', BUDDY_REACTIONS[animIdx]);
      const bubblesEl = button.querySelector('.buddy-bubbles');
      if (bubblesEl) {
        const spark = BUDDY_SPARK_IDS.has(buddyId);
        bubblesEl.innerHTML = Array.from({length: 5}, (_, i) =>
          '<i' + (spark && i % 2 === 0 ? ' class="is-spark"' : '') +
          ' style="--bx:' + (18 + i * 16) + '%;--dx:' + ((i - 2) * 11) + 'px;animation-delay:' + (i * 55) + 'ms"></i>'
        ).join('');
      }
      audio.play('blub');
      clearTimeout(button._blubTimer);
      button._blubTimer = setTimeout(() => button.classList.remove('blub', ...BUDDY_REACTIONS), 1400);
      break;
    }
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
  if (modalKind) {
    if (event.key === 'Escape') { closeModal(); event.preventDefault(); }
    if (event.key === 'Tab') {
      const nodes = [...modalRoot.querySelectorAll('button:not(:disabled),a[href],input,select,textarea,summary')].filter(el=>el.getClientRects().length);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (view === 'play' && session && event.key === 'Enter' && !event.repeat && !event.isComposing && !composing && !event.ctrlKey && !event.altKey && !event.metaKey) {
    if (session.phase === 'reveal' && !event.target?.closest?.('button:not([data-action="next"]),a[href],input,textarea,select,summary')) {
      event.preventDefault();
      audio?.play(session.index === 6 ? 'surface' : 'descend');
      transition(nextRound(session));
    } else if (session.phase === 'correction' && !event.target?.closest?.('#answer-form,button:not([data-action="confirm"]),a[href],input,textarea,select,summary')) {
      event.preventDefault();
      transition(confirmCorrection(session));
    }
  }
});
addEventListener('popstate',()=>{const p=parseRoute();if(p.route==='admin'){location.reload();return;}mode=p.mode;activeGroup=p.group;closeModal();restoreCurrent();render();});
addEventListener('pagehide',()=>{clearTimeout(inputSaveTimer);persist();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)pulse();});
load();
