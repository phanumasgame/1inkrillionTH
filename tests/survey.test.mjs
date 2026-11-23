import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSession, matchAnswer, selectDaily, settleRound, TIERS } from '../src/game.js';
import { emptySave, prepareSaveForBank, readSave, writeSave } from '../src/storage.js';
import { BROAD_ANSWER_TARGET, curatedReason, HYBRID_SCORING, isSurveySession, MIN_PLAYABLE_ANSWERS, prepareSurveyBank, starterExample, SURVEY_TIERS, surveyTier, surveyValue, validateSurveyBank } from '../src/survey.js';

const raw = JSON.parse(await readFile(new URL('../data/survey-bank.json', import.meta.url), 'utf8'));
const bank = prepareSurveyBank(raw);
const make = () => createSession({mode:'daily',bank,questions:selectDaily(bank,'2026-11-17'),date:'2026-11-17',now:1000});

test('v1.0.12 unified 136-question bank has 230k+ answers, 30 1000+ pools, 16 10000+ ultra-mega pools, and calibrated tiers', () => {
  assert.deepEqual(validateSurveyBank(raw), []);
  assert.equal(raw.version, '1.0.12');
  assert.equal(raw.scoringMethod, HYBRID_SCORING);
  assert.equal(raw.questions.length, 136);
  assert.equal(raw.questions.filter(q => q.scope === 'thai').length, 68);
  assert.equal(raw.questions.filter(q => q.scope === 'world').length, 68);
  const surveyQuestions = raw.questions.filter(q => q.survey);
  const curatedQuestions = raw.questions.filter(q => q.curated);
  assert.equal(surveyQuestions.length, 6);
  assert.equal(curatedQuestions.length, 130);
  assert.ok(raw.questions.reduce((sum, q) => sum + q.answers.length, 0) >= 230_000);
  assert.ok(raw.questions.filter(q => q.answers.length >= BROAD_ANSWER_TARGET).length >= 128);
  assert.ok(raw.questions.filter(q => q.answers.length >= 1000).length >= 30);
  assert.ok(raw.questions.filter(q => q.answers.length >= 10000).length >= 16);
  assert.ok(raw.questions.every(q => q.answers.length >= MIN_PLAYABLE_ANSWERS));

  // Verify all 16 Ultra-Mega 10,000+ categories (Group 1, 2, 3, and 4)
  for (const [qid, minAnswers, probe] of [
    ['th-dictionary-words', 14000, 'ความรัก'],
    ['world-wordle-words', 14800, 'WATER'],
    ['th-schools', 11000, 'สวนกุหลาบ'],
    ['th-temples', 11000, 'วัดพระแก้ว'],
    ['world-famous-cities', 11000, 'โตเกียว'],
    ['world-anime', 10000, 'วันพีซ'],
    ['world-famous-movies', 10000, 'ไททานิค'],
    ['world-video-games', 10000, 'Minecraft'],
    ['world-famous-artists', 10000, 'Taylor Swift'],
    ['world-actors-directors', 10000, 'ทอม ครูซ'],
    ['world-animals', 10000, 'ช้าง'],
    ['world-sea-creatures', 10000, 'ฉลาม'],
    ['th-famous-people', 10000, 'เบิร์ด ธงไชย'],
    ['world-fictional-characters', 10000, 'โดราเอมอน'],
    ['th-living-things', 10000, 'ปลากัด'],
    ['world-living-fish', 10000, 'ปลาแซลมอน'],
  ]) {
    const q = raw.questions.find(x => x.id === qid);
    assert.ok(q && q.answers.length >= minAnswers, `Expected ${minAnswers}+ answers in ${qid}, got ${q?.answers.length}`);
    assert.equal(matchAnswer(q, probe).kind, 'exact', `Expected exact match for ${probe} in ${qid}`);
  }

  // Verify all 10 new 1,000+ mega categories (5 Thai + 5 World)
  for (const [qid, probe] of [
    ['th-actors', 'ณเดชน์'],
    ['th-schools', 'สวนกุหลาบ'],
    ['th-thai-athletes', 'บัวขาว'],
    ['th-historical-icons', 'สุนทรภู่'],
    ['th-companies', 'ปตท.'],
    ['world-actors-directors', 'ทอม ครูซ'],
    ['world-athletes', 'เมสซี'],
    ['world-manga', 'วันพีซ'],
    ['world-football-clubs', 'แมนยู'],
    ['world-global-companies', 'Apple'],
  ]) {
    const q = raw.questions.find(x => x.id === qid);
    assert.ok(q && q.answers.length >= 1000, `Expected 1000+ answers in ${qid}, got ${q?.answers.length}`);
    assert.equal(matchAnswer(q, probe).kind, 'exact', `Expected exact match for ${probe} in ${qid}`);
  }

  // Verify split BTS/MRT prompts were consolidated into th-rail-stations and th-shopping-malls maintains 60/60 parity
  assert.equal(raw.questions.find(q => q.id === 'th-bts-stations'), undefined);
  assert.equal(raw.questions.find(q => q.id === 'th-mrt-blue'), undefined);
  const rail = raw.questions.find(q => q.id === 'th-rail-stations');
  assert.ok(rail && rail.answers.length >= 175, 'Unified rail stations should cover all lines');
  for (const station of [
    'อโศก', 'สยาม', 'สามย่าน', 'สถานีสวนจตุจักร', 'จตุจักร', 'หมอชิต', 'หมอชิด',
    'ตลาดพลู', 'เจริญนคร', 'ตลาดบางใหญ่', 'ลาดพร้าว 71', 'อิมแพ็ค เมืองทองธานี',
    'สุวรรณภูมิ', 'กรุงเทพอภิวัฒน์',
  ]) {
    assert.equal(matchAnswer(rail, station).kind, 'exact', 'Station missing: ' + station);
  }
  const malls = raw.questions.find(q => q.id === 'th-shopping-malls');
  assert.ok(malls && malls.answers.length >= 170);
  for (const mall of ['สยามพารากอน', 'MBK', 'เดอะคอมมอนส์', 'เซ็นทรัล เวสต์เกต']) {
    assert.equal(matchAnswer(malls, mall).kind, 'exact', 'Mall missing: ' + mall);
  }

  // Verify v1.0.10 researched Postgres daily-analysis additions & aliases
  for (const [qid, input, expectedTier] of [
    ['th-temples', 'วัดราชบพิธ', 'schooler'],
    ['th-temples', 'วัดราชนัดดาราม', 'schooler'],
    ['th-temples', 'โลหะปราสาท', 'schooler'],
    ['th-temples', 'วัดกู้', 'rare'],
    ['th-temples', 'วัดบวรนิเวศวิหาร', 'plankton'],
    ['th-temples', 'วัดพระเชตุพนวิมลมังคลาราม', 'plankton'],
    ['world-zoo-animals', 'ช้างเอเชีย', 'plankton'],
    ['world-zoo-animals', 'ช้างแอฟริกา', 'plankton'],
    ['world-zoo-animals', 'ระมั้ง', 'rare'],
    ['th-instruments', 'ฆ้องมอญวงเล็ก', 'deepcut'],
    ['world-coffee-orders', 'อเมริกาโน่ส้ม', 'plankton'],
    ['world-coffee-orders', 'อเมริกาโน่น้ำผึ้ง', 'plankton'],
    ['world-coffee-orders', 'อเมริกาโน่มะพร้าว', 'plankton'],
    ['world-coffee-orders', 'อเมริกาโน่โทนิค', 'schooler'],
    ['world-coffee-orders', 'อเมริกาโน่พีช', 'rare'],
    ['world-coffee-orders', 'อเมริกาโน่เสาวรส', 'rare'],
    ['th-home-creatures', 'หนอน', 'schooler'],
    ['world-famous-movies', 'WALL-E', 'plankton'],
    ['world-famous-movies', 'วอลล์อี', 'plankton'],
    ['world-famous-cities', 'คุมาโมโต้', 'rare'],
    ['world-cartoon-characters', 'ไจแอนท์', 'schooler'],
    ['world-cartoon-characters', 'ไจเอ้น', 'schooler'],
    ['world-cartoon-characters', 'เบนเทน', 'schooler'],
    ['world-cartoon-characters', 'เบนเทนนิสัน', 'schooler'],
    ['world-cartoon-characters', 'Ben 10', 'schooler'],
    ['th-festivals', 'แห่ไม้ค้ำ', 'schooler'],
    ['th-songs', 'คุณลำไย', 'schooler'],
    ['world-sushi', 'ซาบะ', 'schooler'],
    ['world-cat-breeds', 'ไทย', 'plankton'],
    ['th-freshwater-fish', 'ปลาบู่ทอง', null],
  ]) {
    const q = raw.questions.find(x => x.id === qid);
    const m = matchAnswer(q, input);
    assert.equal(m.kind, 'exact', `Expected ${input} in ${qid}`);
    if (expectedTier) assert.equal(m.answer.tier, expectedTier, `${qid}:${input} tier`);
  }

  // Tier calibration invariants: no curated pool hands out excessive 100-pt Krillions,
  // and well-known household/classic items stay in familiar tiers.
  for (const q of curatedQuestions) {
    const kCount = q.answers.filter(a => a.tier === 'krillion').length;
    assert.ok(kCount / q.answers.length <= 0.11, `${q.id} krillion ratio too high: ${kCount}/${q.answers.length}`);
  }
  const notKrillionChecks = [
    ['th-ssa-sports-played-2025', 'เทควันโด'],
    ['th-solo-singers', 'โบ สุนิตา'],
    ['th-islands', 'เกาะเกร็ด'],
    ['th-flowers', 'ปีบ'],
    ['th-childhood-cartoons', 'ปังปอนด์'],
    ['th-snack-brands', 'คารามูโจ้'],
    ['th-childhood-games', 'โพงพาง'],
    ['world-banks-connell-musical-instrument', 'กีตาร์โปร่ง'],
    ['world-ice-cream-flavors-idfa-2024', 'สตรอว์เบอร์รี'],
    ['world-cake', 'ทีรามิสุ'],
    ['world-game-consoles', 'Steam Deck'],
    ['world-banks-connell-tool', 'แว่นขยาย'],
    ['world-banks-connell-tool', 'ตลับเมตร'],
  ];
  for (const [qid, label] of notKrillionChecks) {
    const q = raw.questions.find(x => x.id === qid);
    const m = matchAnswer(q, label);
    assert.equal(m.kind, 'exact', `Expected ${label} in ${qid}`);
    assert.ok(['plankton', 'schooler'].includes(m.answer.tier), `${qid}:${label} was ${m.answer.tier}`);
  }

  // Spot-check the 20 new v1.0.9 Thai & World questions
  for (const [qid, probe] of [
    ['th-proverbs', 'ขี่ช้างจับตั๊กแตน'],
    ['th-ghosts-folklore', 'แม่นาคพระโขนง'],
    ['th-literary', 'พระอภัยมณี'],
    ['th-trees', 'ต้นมะม่วง'],
    ['th-breakfast', 'ปาท่องโก๋'],
    ['th-restaurant-chains', 'สุกี้ตี๋น้อย'],
    ['th-bkk-roads', 'สุขุมวิท'],
    ['th-rivers', 'เจ้าพระยา'],
    ['th-universities', 'จุฬา'],
    ['th-songs', 'แสงสุดท้าย'],
    ['world-landmarks', 'หอไอเฟล'],
    ['world-historical-figures', 'ไอน์สไตน์'],
    ['world-mythology', 'ซุส'],
    ['world-fashion-brands', 'Nike'],
    ['world-gems-minerals', 'ไพลิน'],
    ['world-stationery', 'ลิควิด'],
    ['world-weather-nature', 'แสงเหนือ'],
    ['world-body-parts', 'ไส้ติ่ง'],
    ['world-books', 'Harry Potter'],
    ['world-songs', 'Bohemian Rhapsody'],
  ]) {
    const q = raw.questions.find(x => x.id === qid);
    assert.ok(q && q.answers.length >= 100, `Missing or undersized new question: ${qid}`);
    assert.equal(matchAnswer(q, probe).kind, 'exact', `Missing probe ${probe} in ${qid}`);
  }

  const districts = raw.questions.find(q => q.id === 'th-nso-bangkok-districts-census-2010');
  assert.equal(districts.answers.length, 50);
  assert.equal(matchAnswer(districts, 'จตุจักร').answer.id, 'bkk-district-30');
  const tv = raw.questions.find(q => q.id === 'th-nbtc-digital-tv-channels-2025');
  assert.equal(tv.answers.length, 21);
  assert.equal(matchAnswer(tv, 'ช่อง 3').answer.id, 'ch3');

  const isaan = raw.questions.find(q => q.id === 'th-isaan-food');
  assert.ok(isaan.answers.length >= 250);
  for (const dish of ['ส้มตำไทย', 'ตำปูปลาร้า', 'ซอยจุ๊', 'เสือร้องไห้', 'อู๋เพี้ย', 'หมกฮวก', 'ผัดหมี่โคราช', 'แกงเปรอะ', 'ตับหวาน']) {
    assert.equal(matchAnswer(isaan, dish).kind, 'exact', 'Isan dish missing: ' + dish);
  }

  const anime = raw.questions.find(q => q.id === 'world-anime');
  assert.ok(anime.answers.length >= 2000);
  for (const title of ['วันพีซ', 'Attack on Titan', 'ผ่าพิภพไททัน', 'Frieren', 'Jujutsu Kaisen']) {
    assert.equal(matchAnswer(anime, title).kind, 'exact', 'Anime missing: ' + title);
  }
  assert.ok(raw.questions.find(q => q.id === 'world-famous-movies').answers.length >= 2000);
  assert.ok(raw.questions.find(q => q.id === 'world-famous-series').answers.length >= 2000);
  assert.ok(raw.questions.find(q => q.id === 'th-thai-films').answers.length >= 1000);
  assert.ok(raw.questions.find(q => q.id === 'th-thai-dramas').answers.length >= 1000);
  assert.ok(raw.questions.find(q => q.id === 'world-animation-films').answers.length >= 1000);

  const animals = raw.questions.find(q => q.id === 'world-animals');
  assert.ok(animals.answers.length >= 1000);
  assert.equal(matchAnswer(animals, 'จิ้งจก').kind, 'exact');
  const homeCreatures = raw.questions.find(q => q.id === 'th-home-creatures');
  assert.ok(homeCreatures.answers.length >= 100);
  assert.equal(matchAnswer(homeCreatures, 'จิ้งจก').kind, 'exact');

  assert.ok(surveyQuestions.every(q => !q.survey.url.includes('verasight')));
  assert.ok(surveyQuestions.every(q => q.answers.every(a => !('count' in a) && !('tier' in a))));
  assert.ok(curatedQuestions.every(q => q.answers.every(a => SURVEY_TIERS.includes(a.tier) && !('percent' in a) && !('rating' in a) && Boolean(curatedReason(q, a)))));
});

test('overly specific prompts were retired and broader survey + curated questions score cleanly', () => {
  const find = id => raw.questions.find(q => q.id === id);
  for (const retired of [
    'th-roiet-edible-plants-2026',
    'world-acs-birthplaces-2024',
    'world-devographics-2025-movies',
    'world-devographics-2025-music',
    'world-butterflies',
    'world-banks-connell-flower',
    'th-ssa-sports-watched-2025',
    'th-nhes-sweets-and-snacks',
    'th-etda-devices-2022',
    'world-home-tech-dcms-2025'
  ]) {
    assert.equal(find(retired), undefined, retired);
  }

  const snacks = find('th-acfs-named-snacks');
  const vegetables = find('th-acfs-market-vegetables');
  const home = find('th-tunorms-household-objects');
  const khwam = find('th-tunorms-khwam');
  const pokemon = find('world-favourite-pokemon-reddit-2019');
  const countries = find('world-countries');
  const elements = find('world-chemical-elements');
  for (const q of [snacks, vegetables, home, khwam, pokemon, countries, elements])
    assert.ok(q.answers.length >= BROAD_ANSWER_TARGET, q.id);
  assert.equal(matchAnswer(snacks, 'ขนมชั้น').answer.percent, 22.7);
  assert.equal(matchAnswer(snacks, 'ปอกกี้').answer.percent, 12.9);
  assert.equal(matchAnswer(vegetables, 'กะเพรา').answer.percent, 72.7);
  const remote = matchAnswer(home, 'รีโมท').answer;
  assert.equal(remote.label, 'รีโมต');
  assert.ok(surveyValue(home, remote) >= 1 && surveyValue(home, remote) <= 7);
  assert.equal(remote.percent, undefined);
  assert.equal(matchAnswer(khwam, 'ความรัก').kind, 'exact');
  assert.equal(matchAnswer(pokemon, 'ปิกาจู').answer.id, 'pikachu');
  assert.equal(pokemon.answers.length, 805);
  assert.equal(find('th-province-trips').answers.length, 77);
  assert.equal(countries.answers.length, 196);
  assert.equal(find('world-us-states').answers.length, 50);
  assert.ok(find('world-planets-space').answers.length >= 150);
  assert.ok(find('th-national-parks').answers.length >= 150);
  assert.equal(starterExample(snacks).percent >= 22.7, true);
  assert.equal(starterExample(find('world-animals')).tier, 'plankton');
  const broken = structuredClone(raw);
  const rating = broken.questions.find(q => q.id === home.id).answers[0];
  rating.percent = rating.rating;
  assert.ok(validateSurveyBank(broken).some(error => error.includes('invalid measured value')));
});

test('playable prompts use everyday language and accepted names resolve to their published group', () => {
  for (const question of raw.questions) {
    assert.doesNotMatch(question.prompt + ' ' + question.hint,/โพล|ผลสำรวจ|\b20\d\d\b|พ\.?ศ\.?\s*25\d\d/,question.id);
    for (const answer of question.answers) {
      for (const name of [answer.label,...answer.aliases]) {
        assert.equal(matchAnswer(question,name).answer?.id,answer.id,question.id+': '+name);
      }
    }
  }
});

test('game points are derived from published ordering, with equal percentages tied', () => {
  const q=structuredClone(raw.questions[0]);
  q.answers=q.answers.slice(0,5);
  q.answers.forEach((a,i)=>{a.percent=[80,40,40,10,5][i];a.tier='krillion';});
  const values=q.answers.map(a=>surveyTier(q,a.id));
  assert.deepEqual(values,['plankton','schooler','schooler','rare','krillion']);
  assert.equal(surveyTier(q,'not-reported'),null);
  const s=make();s.phase='answer';s.questions[0]=q;
  const result=settleRound(s,q.answers[0],q.answers[0].label,'correct',5000);
  assert.equal(result.results[0].tier,'plankton');
  assert.equal(result.score,TIERS.plankton.score);
});

test('missing provenance or percentage cannot receive a fabricated score or start a dive', () => {
  const baseSlice = [
    ...raw.questions.filter(q => q.scope === 'thai').slice(0, 4),
    ...raw.questions.filter(q => q.scope === 'world' && q.answers.length < 1000).slice(0, 4),
  ];
  for (const modify of [
    q=>delete q.survey,
    q=>delete q.survey.sampleSize,
    q=>delete q.answers[0].percent,
    q=>q.answers[0].percent=0,
    q=>q.answers[0].percent=101,
    q=>q.survey.url='http://example.org',
    q=>q.answers[0].aliases.push(q.answers[1].label)
  ]) {
    const invalid={...raw,questions:baseSlice.map((q,i)=>i===0?structuredClone(q):q)};modify(invalid.questions[0]);
    assert.ok(validateSurveyBank(invalid).length);
    assert.throws(()=>prepareSurveyBank(invalid));
    assert.throws(()=>createSession({mode:'daily',bank:invalid,questions:invalid.questions.slice(0,7),now:1000}));
    const s=make();s.phase='answer';s.questions[0]=structuredClone(raw.questions[0]);modify(s.questions[0]);
    assert.equal(isSurveySession(s),false);
    assert.equal(settleRound(s,s.questions[0].answers[0],'x','correct',5000),s);
    assert.equal(s.score,0);
  }
});

test('legacy editorial games remain stored but are not survey sessions', () => {
  const legacy=make();
  delete legacy.scoringMethod;
  legacy.bankVersion='editorial-old';
  legacy.phase='complete';
  legacy.results=Array.from({length:7},()=>({points:100,tier:'krillion'}));
  legacy.score=700;legacy.depth=7000;
  const saved=emptySave();saved.history=[legacy];saved.daily['old']=legacy;
  const migrated=prepareSaveForBank(saved,bank);
  let contents='';
  const storage={getItem:()=>contents,setItem:(_,value)=>{contents=value;}};
  assert.equal(writeSave(migrated,storage),true);
  const restored=readSave(storage);
  assert.deepEqual(restored.history[0],legacy);
  assert.equal(isSurveySession(restored.history[0]),false);
  legacy.phase='answer';
  assert.equal(settleRound(legacy,legacy.questions[0].answers[0],'x','correct',5000),legacy);
});

test('curated familiarity questions validate strictly and score + save through hybrid sessions', () => {
  const curatedIndex = raw.questions.findIndex(q => q.id === 'world-animals');
  assert.ok(curatedIndex >= 0);
  const curatedSlice = [
    structuredClone(raw.questions[curatedIndex]),
    ...raw.questions.filter(q => q.scope === 'thai' && q.answers.length < 1000).slice(0, 4),
    ...raw.questions.filter(q => q.scope === 'world' && q.id !== 'world-animals' && q.answers.length < 1000).slice(0, 3),
  ];
  for (const modify of [
    q => { delete q.curated.basis; },
    q => { delete q.curated.coverage; },
    q => { delete q.answers[0].reason; delete q.curated.tierReasons; },
    q => { q.curated.tierReasons = { invalid: 'x' }; },
    q => { q.answers[0].percent = 50; },
    q => { q.answers.forEach(a => { if (a.tier === 'krillion') a.tier = 'rare'; }); },
    q => { q.survey = structuredClone(raw.questions[0].survey); }
  ]) {
    const invalid = { ...raw, questions: curatedSlice.map((q, i) => i === 0 ? structuredClone(q) : q) };
    modify(invalid.questions[0]);
    assert.ok(validateSurveyBank(invalid).length > 0);
    assert.throws(() => prepareSurveyBank(invalid));
  }

  const animals = structuredClone(raw.questions[curatedIndex]);
  const s = make();
  s.phase = 'answer';
  s.questions[0] = animals;
  const jingjok = matchAnswer(animals, 'จิ้งจก').answer;
  assert.equal(surveyTier(animals, jingjok.id), jingjok.tier);
  const result = settleRound(s, jingjok, 'จิ้งจก', 'correct', 5000);
  assert.equal(result.results[0].tier, jingjok.tier);
  assert.equal(result.score, TIERS[jingjok.tier].score);
  const saved = emptySave();
  saved.daily['2026-11-17@' + raw.version] = result;
  let contents = '';
  const storage = { getItem: () => contents, setItem: (_, value) => { contents = value; } };
  assert.equal(writeSave(saved, storage), true);
  const restored = readSave(storage);
  const restoredSession = restored.daily['2026-11-17@' + raw.version];
  assert.equal(isSurveySession(restoredSession), true);
  assert.equal(restoredSession.results[0].answerId, jingjok.id);
});
