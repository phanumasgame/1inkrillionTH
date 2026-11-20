import { ensureSchema } from './schema.js';
import { normalize } from '../src/answers.js';
import { matchAnswer } from '../src/game.js';

export const DEFAULT_TZ = 'Asia/Bangkok';

const CATEGORY_PREFIXES = [
  'ปลา', 'ต้น', 'ดอก', 'แม่น้ำ', 'คลอง', 'ถนน', 'ซอย', 'เกาะ', 'หาด', 'น้ำตก',
  'อุทยานแห่งชาติ', 'วัด', 'แมว', 'นก', 'สุนัข', 'ภาษา', 'สี', 'กีฬา',
];
const TEMPLE_SUFFIX_RE = /(?:ราชวรมหาวิหาร|ราชวรวิหาร|วรมหาวิหาร|วรวิหาร|มหาวิหาร|วิหาร|ฯ)+$/g;

const compactKey = s => normalize(s).replace(/[-.\s·()'"!?]/g, '');

function templeStem(s) {
  let out = normalize(s).replace(/\s+/g, '');
  if (!out.startsWith('วัด')) return '';
  out = out.slice(3).replace(TEMPLE_SUFFIX_RE, '');
  return out;
}

function editDistanceAtMost2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  if (a === b) return true;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = cur;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > 2) return false;
  }
  return dp[b.length] <= 2;
}

export function bangkokDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function findAliasTargetInQuestion(question, rawText) {
  if (!question?.answers) return null;
  const m = matchAnswer(question, String(rawText ?? ''));
  if (m.kind === 'exact') return { kind: 'exact', answer: m.answer, reason: 'มีในคลังแล้ว' };
  if (m.kind === 'close') return { kind: 'close', answer: m.answer, reason: 'คำสะกดใกล้เคียง (close match)' };

  const norm = normalize(rawText);
  const compact = compactKey(rawText);
  if (compact.length < 2) return null;

  const tStem = templeStem(rawText);
  for (const ans of question.answers) {
    const names = [ans.label, ...(ans.aliases || [])];
    for (const name of names) {
      const existingNorm = normalize(name);
      const existingCompact = compactKey(name);
      if (!existingCompact) continue;

      if (compact === existingCompact) {
        return { kind: 'variant', answer: ans, reason: 'รูปแบบขีด/เว้นวรรคต่างจากคำหลัก' };
      }

      if (tStem.length >= 2) {
        const aStem = templeStem(name);
        if (aStem && (aStem === tStem || aStem.startsWith(tStem) || tStem.startsWith(aStem)) && Math.min(aStem.length, tStem.length) >= 4) {
          return { kind: 'variant', answer: ans, reason: `ชื่อเรียกย่อ/สร้อยวัดของ "${ans.label}"` };
        }
      }

      for (const prefix of CATEGORY_PREFIXES) {
        if (existingNorm === prefix + norm || existingCompact === compactKey(prefix) + compact) {
          return { kind: 'variant', answer: ans, reason: `ตัดคำนำหน้า "${prefix}" ของ "${ans.label}"` };
        }
      }
    }
  }
  return null;
}

export function findCrossQuestionMatch(bank, sourceQuestion, rawText) {
  const q = typeof sourceQuestion === 'string'
    ? (bank?.questions || []).find(x => x.id === sourceQuestion)
    : sourceQuestion;
  const excludeQuestionId = q?.id || (typeof sourceQuestion === 'string' ? sourceQuestion : '');
  const sourceTheme = q?.theme || '';
  const c = compactKey(rawText);
  const tStem = templeStem(rawText);
  if (c.length < 2) return null;
  for (const oq of bank?.questions || []) {
    if (oq.id === excludeQuestionId) continue;
    if (sourceTheme && oq.theme !== sourceTheme) continue;
    // Do not cross-adopt plant/flower labels into animal questions
    if (/flower|tree|herb|fruit|vegetable/i.test(oq.id) !== /flower|tree|herb|fruit|vegetable/i.test(excludeQuestionId)) continue;
    for (const a of oq.answers || []) {
      for (const n of [a.label, ...(a.aliases || [])]) {
        const nc = compactKey(n);
        if (nc === c || (tStem.length >= 4 && templeStem(n) === tStem)) {
          return { questionId: oq.id, label: a.label, aliases: a.aliases || [], tier: a.tier || '' };
        }
      }
    }
  }
  return null;
}

export function checkBankCoverage(questionById, questionId, rawText) {
  const q = questionById?.get(questionId);
  if (!q) {
    return {
      status: 'unknown_question',
      questionPrompt: '',
      matchedLabel: '',
      matchedTier: '',
    };
  }
  const m = matchAnswer(q, String(rawText ?? ''));
  if (m.kind === 'exact') {
    return {
      status: 'covered',
      questionPrompt: q.prompt,
      matchedLabel: m.answer?.label || '',
      matchedTier: m.answer?.tier || '',
    };
  }
  if (m.kind === 'close') {
    return {
      status: 'close',
      questionPrompt: q.prompt,
      matchedLabel: m.answer?.label || '',
      matchedTier: m.answer?.tier || '',
    };
  }
  return {
    status: 'missing',
    questionPrompt: q.prompt,
    matchedLabel: '',
    matchedTier: '',
  };
}

export function buildAdditionPlan(bank, questionById, suggestions, rejectedGuesses) {
  // Merge suggestions & rejected guesses per (question_id, normalized/compact)
  const merged = new Map();

  function upsert(row, kind) {
    const qid = row.question_id;
    const rawSample = kind === 'suggestion' ? row.sample_answer : row.sample_input;
    const norm = normalize(rawSample);
    const key = `${qid}::${compactKey(rawSample) || norm}`;
    const prev = merged.get(key) || {
      questionId: qid,
      prompt: row.prompt || questionById.get(qid)?.prompt || qid,
      sample: rawSample,
      norm,
      compact: compactKey(rawSample),
      suggestionCount: 0,
      rejectedCount: 0,
      todayCount: 0,
      latestVersion: row.latest_version || '',
      notes: '',
      bankStatus: row.bankStatus,
    };
    if (kind === 'suggestion') {
      prev.suggestionCount += num(row.total_count);
      if (row.notes && !prev.notes.includes(row.notes)) {
        prev.notes = prev.notes ? `${prev.notes} | ${row.notes}` : row.notes;
      }
      // Prefer explicit survey wording over rejected typo
      if (rawSample) prev.sample = rawSample;
    } else {
      prev.rejectedCount += num(row.total_count);
    }
    prev.todayCount += num(row.today_count);
    if (row.latest_version && row.latest_version > prev.latestVersion) {
      prev.latestVersion = row.latest_version;
    }
    merged.set(key, prev);
  }

  for (const s of suggestions) upsert(s, 'suggestion');
  for (const r of rejectedGuesses) upsert(r, 'rejected');

  const newAnswers = [];
  const newAliases = [];
  const reviewOrSkip = [];
  const pendingAnswersByQ = new Map();

  // Process suggestions first, then cross-matched canonical hits, then higher-count rejected entries
  const items = [...merged.values()]
    .map(item => ({
      ...item,
      _cross: findCrossQuestionMatch(bank, questionById.get(item.questionId) || item.questionId, item.sample),
    }))
    .sort((a, b) =>
      ((b.suggestionCount > 0 ? 1 : 0) - (a.suggestionCount > 0 ? 1 : 0))
      || ((b._cross ? 1 : 0) - (a._cross ? 1 : 0))
      || ((b.suggestionCount + b.rejectedCount) - (a.suggestionCount + a.rejectedCount))
      || (a.compact.length - b.compact.length)
    );

  for (const item of items) {
    const q = questionById.get(item.questionId);
    const totalHits = item.suggestionCount + item.rejectedCount;
    const sources = [
      item.suggestionCount ? `survey(${item.suggestionCount})` : '',
      item.rejectedCount ? `rejected(${item.rejectedCount})` : '',
    ].filter(Boolean).join(' + ');

    if (!q) {
      reviewOrSkip.push({ ...item, totalHits, sources, reason: 'ไม่พบรหัสโจทย์ในคลังปัจจุบัน' });
      continue;
    }
    if (item.compact.length < 2 || /^[\d\s]+$/.test(item.norm)) {
      reviewOrSkip.push({ ...item, totalHits, sources, reason: 'สั้นเกินเกณฑ์หรือเป็นตัวอักษรเดี่ยว/ตัวเลข' });
      continue;
    }

    const aliasHit = findAliasTargetInQuestion(q, item.sample);
    if (aliasHit?.kind === 'exact') continue; // already covered in bank

    if (aliasHit) {
      newAliases.push({
        questionId: item.questionId,
        prompt: item.prompt,
        alias: item.sample,
        targetId: aliasHit.answer.id,
        targetLabel: aliasHit.answer.label,
        targetTier: aliasHit.answer.tier || '',
        reason: aliasHit.reason,
        suggestionCount: item.suggestionCount,
        rejectedCount: item.rejectedCount,
        totalHits,
        todayCount: item.todayCount,
        latestVersion: item.latestVersion,
        sources,
      });
      continue;
    }

    // Check if this ASCII/Thai variant matches an already-queued New Answer in same Q (by crossMatch or edit distance <= 2)
    const qQueue = pendingAnswersByQ.get(item.questionId) || [];
    const crossDupParent = item._cross
      ? qQueue.find(p => p.rec.label === item._cross.label)
      : null;
    if (crossDupParent) {
      if (!crossDupParent.rec.suggestedAliases.some(x => compactKey(x) === item.compact) && normalize(crossDupParent.rec.label) !== item.norm) {
        crossDupParent.rec.suggestedAliases.push(item.sample);
      }
      crossDupParent.rec.rejectedCount += item.rejectedCount;
      crossDupParent.rec.suggestionCount += item.suggestionCount;
      crossDupParent.rec.totalHits += totalHits;
      continue;
    }
    const typoParent = /^[a-z0-9]+$/.test(item.compact) && item.compact.length >= 4
      ? qQueue.find(p => /^[a-z0-9]+$/.test(p.compact) && editDistanceAtMost2(item.compact, p.compact))
      : null;
    if (typoParent) {
      reviewOrSkip.push({
        ...item,
        totalHits,
        sources,
        reason: `พิมพ์คลาดเคลื่อนจาก "${typoParent.sample}" (จัดกลุ่มซ้ำออกแล้ว)`,
      });
      continue;
    }

    const cross = item._cross;
    // Only reuse cross-question canonical label if the target answer's own label isn't a different drink/variant
    const canAdoptCrossLabel = cross && (
      normalize(cross.label) === item.norm
      || compactKey(cross.label) === item.compact
      || /^[a-z0-9\s-]+$/i.test(item.sample)
      || (item.sample.startsWith('วัด') && cross.label.startsWith(item.sample))
    );
    const preferredLabel = canAdoptCrossLabel ? cross.label : item.sample;
    const autoAliases = canAdoptCrossLabel
      ? [...new Set([item.sample, ...(cross.aliases || [])].filter(x => normalize(x) !== normalize(preferredLabel)))].slice(0, 4)
      : [];

    const rec = {
      questionId: item.questionId,
      prompt: item.prompt,
      label: preferredLabel,
      submittedText: item.sample,
      suggestedAliases: autoAliases,
      suggestedTier: cross?.tier || (item.rejectedCount >= 2 || item.suggestionCount >= 2 ? 'schooler' : 'rare'),
      crossMatch: canAdoptCrossLabel ? `${cross.questionId}: ${cross.label}` : '',
      suggestionCount: item.suggestionCount,
      rejectedCount: item.rejectedCount,
      totalHits,
      todayCount: item.todayCount,
      latestVersion: item.latestVersion,
      notes: item.notes,
      sources,
    };
    newAnswers.push(rec);
    qQueue.push({ ...item, rec });
    pendingAnswersByQ.set(item.questionId, qQueue);
  }

  return {
    newAnswers,
    newAliases,
    reviewOrSkip,
  };
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function generateDailyAnalysis(
  sql,
  bank,
  { date = bangkokDateString(), tz = DEFAULT_TZ, topLimit = 60, ensure = ensureSchema } = {}
) {
  await ensure(sql);
  const questionById = new Map((bank?.questions || []).map(q => [q.id, q]));

  // 1. dive_sessions
  const [sessionOverview] = await sql.query(
    `SELECT
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_sessions,
       COUNT(DISTINCT NULLIF(client_id, '')) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_players,
       COALESCE(ROUND(AVG(score) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::numeric, 1), 0) AS today_avg_score,
       COALESCE(MAX(score) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date), 0)::int AS today_max_score,
       COALESCE(ROUND(AVG(depth) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::numeric, 0), 0)::int AS today_avg_depth,
       COALESCE(SUM(gems) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date), 0)::int AS today_gems,
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date AND mode = 'daily')::int AS today_daily,
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date AND mode = 'endless')::int AS today_endless,
       COUNT(*)::int AS total_sessions,
       COUNT(DISTINCT NULLIF(client_id, ''))::int AS total_players,
       COALESCE(ROUND(AVG(score)::numeric, 1), 0) AS total_avg_score,
       COALESCE(MAX(score), 0)::int AS total_max_score,
       COALESCE(ROUND(AVG(depth)::numeric, 0), 0)::int AS total_avg_depth,
       COALESCE(SUM(gems), 0)::int AS total_gems,
       COUNT(*) FILTER (WHERE mode = 'daily')::int AS total_daily,
       COUNT(*) FILTER (WHERE mode = 'endless')::int AS total_endless
     FROM dive_sessions`,
    [tz, date]
  );

  const sessionsByVersion = await sql.query(
    `SELECT COALESCE(NULLIF(bank_version, ''), '(unknown)') AS bank_version,
            COUNT(*)::int AS sessions,
            COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_sessions,
            COALESCE(ROUND(AVG(score)::numeric, 1), 0) AS avg_score,
            COALESCE(SUM(gems), 0)::int AS gems
     FROM dive_sessions
     GROUP BY COALESCE(NULLIF(bank_version, ''), '(unknown)')
     ORDER BY today_sessions DESC, sessions DESC`,
    [tz, date]
  );

  const dailyTrend = await sql.query(
    `SELECT ((created_at AT TIME ZONE $1)::date)::text AS day,
            COUNT(*)::int AS sessions,
            COUNT(DISTINCT NULLIF(client_id, ''))::int AS players,
            COALESCE(ROUND(AVG(score)::numeric, 1), 0) AS avg_score,
            COALESCE(SUM(gems), 0)::int AS gems
     FROM dive_sessions
     GROUP BY (created_at AT TIME ZONE $1)::date
     ORDER BY day DESC
     LIMIT 7`,
    [tz]
  );

  // 2. round_attempts
  const [roundOverview] = await sql.query(
    `SELECT
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_rounds,
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date AND outcome IN ('correct','corrected'))::int AS today_hits,
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date AND outcome = 'skip')::int AS today_skips,
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date AND outcome = 'timeout')::int AS today_timeouts,
       COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date AND tier = 'krillion')::int AS today_krillions,
       COALESCE(ROUND(AVG(elapsed_ms) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::numeric, 0), 0)::int AS today_avg_ms,
       COUNT(*)::int AS total_rounds,
       COUNT(*) FILTER (WHERE outcome IN ('correct','corrected'))::int AS total_hits,
       COUNT(*) FILTER (WHERE outcome = 'skip')::int AS total_skips,
       COUNT(*) FILTER (WHERE outcome = 'timeout')::int AS total_timeouts,
       COUNT(*) FILTER (WHERE tier = 'krillion')::int AS total_krillions,
       COALESCE(ROUND(AVG(elapsed_ms)::numeric, 0), 0)::int AS total_avg_ms
     FROM round_attempts`,
    [tz, date]
  );

  const tierBreakdown = await sql.query(
    `SELECT CASE WHEN outcome IN ('skip','timeout') THEN outcome ELSE COALESCE(NULLIF(tier, ''), 'unknown') END AS bucket,
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_count,
            COALESCE(ROUND(AVG(elapsed_ms)::numeric, 0), 0)::int AS avg_ms
     FROM round_attempts
     GROUP BY 1
     ORDER BY total_count DESC`,
    [tz, date]
  );

  const questionStatsRaw = await sql.query(
    `SELECT question_id,
            COUNT(*)::int AS plays,
            COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_plays,
            COUNT(*) FILTER (WHERE outcome IN ('skip','timeout'))::int AS misses,
            COUNT(*) FILTER (WHERE tier = 'krillion')::int AS krillions,
            COALESCE(ROUND(AVG(points)::numeric, 1), 0) AS avg_points,
            COALESCE(ROUND(AVG(elapsed_ms)::numeric, 0), 0)::int AS avg_ms,
            COALESCE(ROUND(AVG(jsonb_array_length(rejected_inputs))::numeric, 2), 0) AS avg_rejected
     FROM round_attempts
     GROUP BY question_id
     ORDER BY plays DESC, misses DESC`,
    [tz, date]
  );

  const questionStats = questionStatsRaw.map(row => {
    const q = questionById.get(row.question_id);
    const plays = num(row.plays);
    const misses = num(row.misses);
    return {
      ...row,
      prompt: q?.prompt || row.question_id,
      poolSize: q?.answers?.length || 0,
      missRatePct: plays ? Number(((misses / plays) * 100).toFixed(1)) : 0,
      avgPoints: num(row.avg_points),
      avgRejected: num(row.avg_rejected),
    };
  });

  // 3. answer_suggestions
  const [suggestionCounts] = await sql.query(
    `SELECT COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_rows,
            COUNT(*)::int AS total_rows,
            COUNT(DISTINCT question_id)::int AS questions_with_suggestions,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_rows
     FROM answer_suggestions`,
    [tz, date]
  );

  const groupedSuggestionsRaw = await sql.query(
    `SELECT question_id,
            MAX(question_prompt) AS question_prompt,
            MIN(suggested_answer) AS sample_answer,
            normalized_answer,
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_count,
            MAX(bank_version) AS latest_version,
            MAX(source) AS source,
            STRING_AGG(DISTINCT NULLIF(note, ''), ' | ') AS notes,
            MAX(created_at) AS last_seen
     FROM answer_suggestions
     GROUP BY question_id, normalized_answer
     ORDER BY today_count DESC, total_count DESC, last_seen DESC
     LIMIT $3`,
    [tz, date, topLimit * 3]
  );

  const suggestions = groupedSuggestionsRaw.map(row => {
    const cov = checkBankCoverage(questionById, row.question_id, row.sample_answer);
    return {
      ...row,
      prompt: cov.questionPrompt || row.question_prompt || row.question_id,
      bankStatus: cov.status,
      matchedLabel: cov.matchedLabel,
      matchedTier: cov.matchedTier,
    };
  });

  // 4. rejected_guesses
  const [rejectedCounts] = await sql.query(
    `SELECT COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_rows,
            COUNT(*)::int AS total_rows,
            COUNT(DISTINCT (question_id || '::' || normalized_input))::int AS unique_misses
     FROM rejected_guesses`,
    [tz, date]
  );

  const groupedRejectedRaw = await sql.query(
    `SELECT question_id,
            normalized_input,
            MIN(raw_input) AS sample_input,
            COUNT(*)::int AS total_count,
            COUNT(*) FILTER (WHERE (created_at AT TIME ZONE $1)::date = $2::date)::int AS today_count,
            MAX(bank_version) AS latest_version,
            MAX(created_at) AS last_seen
     FROM rejected_guesses
     GROUP BY question_id, normalized_input
     ORDER BY today_count DESC, total_count DESC, last_seen DESC
     LIMIT $3`,
    [tz, date, topLimit * 3]
  );

  const rejectedGuesses = groupedRejectedRaw.map(row => {
    const cov = checkBankCoverage(questionById, row.question_id, row.sample_input);
    return {
      ...row,
      prompt: cov.questionPrompt || row.question_id,
      bankStatus: cov.status,
      matchedLabel: cov.matchedLabel,
      matchedTier: cov.matchedTier,
    };
  });

  const actionableSuggestions = suggestions.filter(s => s.bankStatus === 'missing');
  const closeSuggestions = suggestions.filter(s => s.bankStatus === 'close');
  const alreadyCoveredSuggestions = suggestions.filter(s => s.bankStatus === 'covered');
  const actionableRejected = rejectedGuesses.filter(r => r.bankStatus === 'missing');
  const closeRejected = rejectedGuesses.filter(r => r.bankStatus === 'close');

  const recommendations = buildAdditionPlan(bank, questionById, suggestions, rejectedGuesses);

  const insights = [];
  if (recommendations.newAnswers.length || recommendations.newAliases.length) {
    insights.push(
      `รายการเข้าเกณฑ์เพิ่มเติมเทียบกับคลัง v${bank?.version || '?'}: คำตอบหลักใหม่ (New Answer) ${recommendations.newAnswers.length} รายการ และคำเรียกอื่น (New Alias) ${recommendations.newAliases.length} รายการ`
    );
  }
  if (suggestions.length) {
    insights.push(
      `ข้อเสนอ Survey ทั้งหมด ${suggestions.length} รายการ (ไม่ซ้ำ): เพิ่มเข้าคลังแล้ว ${alreadyCoveredSuggestions.length} รายการ, รอเติม/ผูก alias ${actionableSuggestions.length + closeSuggestions.length} รายการ`
    );
  }
  const hardQuestions = questionStats.filter(q => q.misses > 0 && (q.missRatePct >= 50 || q.avgRejected >= 1)).slice(0, 5);
  if (hardQuestions.length) {
    insights.push(
      `โจทย์ที่ผู้เล่นพลาดหรือพิมพ์ไม่ผ่านบ่อยสุด: ${hardQuestions.map(q => `${q.question_id} (พลาด ${q.misses}/${q.plays}, พิมพ์ไม่ผ่านเฉลี่ย ${q.avgRejected} ครั้ง)`).join('; ')}`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    date,
    timezone: tz,
    bankVersion: bank?.version || 'unknown',
    bankQuestionCount: bank?.questions?.length || 0,
    sessions: {
      overview: sessionOverview || {},
      byVersion: sessionsByVersion,
      dailyTrend,
    },
    rounds: {
      overview: roundOverview || {},
      tiers: tierBreakdown,
      byQuestion: questionStats,
    },
    suggestions: {
      counts: suggestionCounts || {},
      items: suggestions.slice(0, topLimit),
      actionable: actionableSuggestions,
      close: closeSuggestions,
      covered: alreadyCoveredSuggestions,
    },
    rejected: {
      counts: rejectedCounts || {},
      items: rejectedGuesses.slice(0, topLimit),
      actionable: actionableRejected,
      close: closeRejected,
    },
    recommendations,
    insights,
  };
}

export function formatDailyReportMarkdown(report) {
  const s = report.sessions.overview;
  const r = report.rounds.overview;
  const sg = report.suggestions.counts;
  const rj = report.rejected.counts;
  const rec = report.recommendations || { newAnswers: [], newAliases: [], reviewOrSkip: [] };

  const lines = [];
  lines.push(`# สรุปวิเคราะห์ข้อมูลรายวัน Krillion TH (${report.date} · ${report.timezone})`);
  lines.push(`เทียบคลังปัจจุบัน: **v${report.bankVersion}** (${report.bankQuestionCount} โจทย์)`);
  lines.push('');

  lines.push('## 1) ภาพรวมการเล่นรายวันและสะสม (`dive_sessions` & `round_attempts`)');
  lines.push('| ตัวชี้วัด | วันนี้ (' + report.date + ') | สะสมทั้งหมด |');
  lines.push('| --- | ---: | ---: |');
  lines.push(`| จำนวนรอบที่เล่นจบ | ${num(s.today_sessions)} | ${num(s.total_sessions)} |`);
  lines.push(`| ผู้เล่นไม่ซ้ำ (client_id) | ${num(s.today_players)} | ${num(s.total_players)} |`);
  lines.push(`| โหมด Daily / Endless | ${num(s.today_daily)} / ${num(s.today_endless)} | ${num(s.total_daily)} / ${num(s.total_endless)} |`);
  lines.push(`| คะแนนเฉลี่ย / สูงสุด | ${num(s.today_avg_score)} / ${num(s.today_max_score)} | ${num(s.total_avg_score)} / ${num(s.total_max_score)} |`);
  lines.push(`| ความลึกเฉลี่ย (m) | ${num(s.today_avg_depth)} | ${num(s.total_avg_depth)} |`);
  lines.push(`| ข้อทั้งหมดที่เล่น (rounds) | ${num(r.today_rounds)} | ${num(r.total_rounds)} |`);
  lines.push(`| ตอบถูก / Skip / Timeout | ${num(r.today_hits)} / ${num(r.today_skips)} / ${num(r.today_timeouts)} | ${num(r.total_hits)} / ${num(r.total_skips)} / ${num(r.total_timeouts)} |`);
  lines.push(`| จำนวน Krillion ที่ได้ | ${num(r.today_krillions)} | ${num(r.total_krillions)} |`);
  lines.push(`| เวลาเฉลี่ยต่อข้อ (ms) | ${num(r.today_avg_ms)} | ${num(r.total_avg_ms)} |`);
  lines.push('');

  if (report.sessions.byVersion.length) {
    lines.push('**แยกตามเวอร์ชันคลัง:**');
    for (const v of report.sessions.byVersion) {
      lines.push(`- \`v${v.bank_version}\`: ${v.today_sessions} รอบวันนี้ / ${v.sessions} รอบทั้งหมด (เฉลี่ย ${v.avg_score} แต้ม, ${v.gems} Krillion)`);
    }
    lines.push('');
  }

  if (report.rounds.tiers.length) {
    lines.push('**สัดส่วนผลลัพธ์รายข้อ (`round_attempts`):**');
    for (const t of report.rounds.tiers) {
      lines.push(`- **${t.bucket}**: ${t.today_count} ครั้งวันนี้ / ${t.total_count} ครั้งทั้งหมด (เวลาเฉลี่ย ${t.avg_ms}ms)`);
    }
    lines.push('');
  }

  lines.push(`## 2) คำที่เข้าเกณฑ์ควรเพิ่มในคลัง — แยก Answer กับ Alias (รวม \`answer_suggestions\` [${num(sg.total_rows)}] + \`rejected_guesses\` [${num(rj.total_rows)}])`);

  lines.push(`\n### หมวด A: คำตอบหลักใหม่ (New Answer) — ${rec.newAnswers.length} รายการ`);
  if (rec.newAnswers.length) {
    lines.push('| โจทย์ | คำตอบหลัก (`label`) | Alias แนะนำ | ระดับแนะนำ | ที่มา | หมายเหตุ |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const a of rec.newAnswers) {
      const aliasCol = a.suggestedAliases.length ? a.suggestedAliases.join(', ') : '-';
      const noteCol = a.crossMatch ? `อ้างอิงจาก ${a.crossMatch}` : (a.notes || '-');
      lines.push(`| \`${a.questionId}\` | **${a.label}** | ${aliasCol} | \`${a.suggestedTier}\` | ${a.sources} | ${noteCol} |`);
    }
  } else {
    lines.push('_ไม่มีคำตอบหลักใหม่ค้างเพิ่ม_');
  }

  lines.push(`\n### หมวด B: คำเรียกอื่น / Alias ของคำเดิม (New Alias) — ${rec.newAliases.length} รายการ`);
  if (rec.newAliases.length) {
    lines.push('| โจทย์ | Alias ใหม่ | ผูกกับคำหลักในคลัง (`label`) | เหตุผล | ที่มา |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const al of rec.newAliases) {
      lines.push(`| \`${al.questionId}\` | **${al.alias}** | ${al.targetLabel} (\`${al.targetTier}\`) | ${al.reason} | ${al.sources} |`);
    }
  } else {
    lines.push('_ไม่มี alias ใหม่ค้างเพิ่ม_');
  }

  if (rec.reviewOrSkip.length) {
    lines.push(`\n### หมวด C: รายการที่ตัดออก / รอคัดกรองเพิ่มเติม — ${rec.reviewOrSkip.length} รายการ`);
    for (const sk of rec.reviewOrSkip) {
      lines.push(`- \`${sk.questionId}\` · "${sk.sample}" (${sk.sources}): ${sk.reason}`);
    }
  }
  lines.push('');

  lines.push('## 3) ข้อค้นพบและคำแนะนำเชิงวิเคราะห์ (Insights)');
  if (report.insights.length) {
    for (const ins of report.insights) lines.push(`- ${ins}`);
  } else {
    lines.push('- ข้อมูลยังน้อยในวันที่เลือก หรือคำตอบที่ผู้เล่นเสนอส่วนใหญ่ถูกครอบคลุมในคลังปัจจุบันแล้ว');
  }

  return lines.join('\n');
}
