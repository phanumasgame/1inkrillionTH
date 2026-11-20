import { ensureSchema } from './schema.js';
import { matchAnswer } from '../src/game.js';

export const DEFAULT_TZ = 'Asia/Bangkok';

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

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function generateDailyAnalysis(
  sql,
  bank,
  { date = bangkokDateString(), tz = DEFAULT_TZ, topLimit = 40, ensure = ensureSchema } = {}
) {
  await ensure(sql);
  const questionById = new Map((bank?.questions || []).map(q => [q.id, q]));

  // 1. dive_sessions (Table 1: Session & Player Overview)
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

  // 2. round_attempts (Table 2: Tiers, Outcomes & Question Balance)
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

  // 3. answer_suggestions (Table 3: Player Survey Suggestions)
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
    [tz, date, topLimit * 2]
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

  // 4. rejected_guesses (Table 4: Player Failed / Rejected Inputs)
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
    [tz, date, topLimit * 2]
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

  // 5. Compute actionable insights automatically
  const actionableSuggestions = suggestions.filter(s => s.bankStatus === 'missing');
  const closeSuggestions = suggestions.filter(s => s.bankStatus === 'close');
  const alreadyCoveredSuggestions = suggestions.filter(s => s.bankStatus === 'covered');
  const actionableRejected = rejectedGuesses.filter(r => r.bankStatus === 'missing');
  const closeRejected = rejectedGuesses.filter(r => r.bankStatus === 'close');

  const insights = [];
  if (actionableRejected.length) {
    insights.push(
      `พบคำตอบที่ผู้เล่นพิมพ์ไม่ผ่านและยังไม่มีในคลัง v${bank?.version || '?'} จำนวน ${actionableRejected.length} คำ (เช่น ${actionableRejected.slice(0, 5).map(r => `"${r.sample_input}" [${r.question_id}]`).join(', ')})`
    );
  }
  if (closeRejected.length) {
    insights.push(
      `พบคำที่พิมพ์แล้วเกือบตรงคลัง (ควรพิจารณาเพิ่ม alias) ${closeRejected.length} คำ (เช่น ${closeRejected.slice(0, 4).map(r => `"${r.sample_input}" ≈ "${r.matchedLabel}"`).join(', ')})`
    );
  }
  if (suggestions.length) {
    insights.push(
      `ข้อเสนอ Survey ทั้งหมด ${suggestions.length} รายการ (ไม่ซ้ำ): เพิ่มเข้าคลังแล้ว ${alreadyCoveredSuggestions.length} รายการ, ใกล้เคียง ${closeSuggestions.length} รายการ, ยังขาดจริง ${actionableSuggestions.length} รายการ`
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
    insights,
  };
}

export function formatDailyReportMarkdown(report) {
  const s = report.sessions.overview;
  const r = report.rounds.overview;
  const sg = report.suggestions.counts;
  const rj = report.rejected.counts;

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

  lines.push(`## 2) ข้อเสนอคำตอบจาก Survey (\`answer_suggestions\`) — วันนี้ ${num(sg.today_rows)} · สะสม ${num(sg.total_rows)} รายการ (รอดำเนินการ ${num(sg.pending_rows)})`);
  lines.push(`- เทียบกับคลัง **v${report.bankVersion}**: ยังไม่มีในคลัง **${report.suggestions.actionable.length}** รายการ | ใกล้เคียง (น่าเพิ่ม alias) **${report.suggestions.close.length}** รายการ | มีอยู่แล้ว **${report.suggestions.covered.length}** รายการ`);
  if (report.suggestions.actionable.length) {
    lines.push('\n**รายการเสนอที่ยังไม่มีในคลังปัจจุบัน (ควรพิจารณาเพิ่ม):**');
    lines.push('| โจทย์ | คำที่เสนอ | จำนวนครั้ง | เวอร์ชัน | หมายเหตุ |');
    lines.push('| --- | --- | ---: | --- | --- |');
    for (const item of report.suggestions.actionable.slice(0, 20)) {
      lines.push(`| \`${item.question_id}\` | ${item.sample_answer} | ${item.total_count} | ${item.latest_version || '-'} | ${item.notes || '-'} |`);
    }
  }
  lines.push('');

  lines.push(`## 3) คำตอบที่ผู้เล่นพิมพ์แล้วระบบปฏิเสธ (\`rejected_guesses\`) — วันนี้ ${num(rj.today_rows)} · สะสม ${num(rj.total_rows)} รายการ (${num(rj.unique_misses)} คำไม่ซ้ำ)`);
  if (report.rejected.items.length) {
    lines.push('| โจทย์ | คำที่ผู้เล่นพิมพ์ | วันนี้ / รวม | เวอร์ชัน | สถานะใน v' + report.bankVersion + ' |');
    lines.push('| --- | --- | ---: | --- | --- |');
    for (const item of report.rejected.items.slice(0, 25)) {
      const statusLabel = item.bankStatus === 'missing'
        ? 'ยังไม่มี (MISSING)'
        : item.bankStatus === 'close'
          ? `ใกล้เคียง "${item.matchedLabel}" (CLOSE)`
          : item.bankStatus === 'covered'
            ? `มีแล้ว "${item.matchedLabel}" (${item.matchedTier})`
            : 'ไม่พบโจทย์';
      lines.push(`| \`${item.question_id}\` | ${item.sample_input} | ${item.today_count} / ${item.total_count} | ${item.latest_version || '-'} | ${statusLabel} |`);
    }
  } else {
    lines.push('_ยังไม่มีคำตอบที่ถูกปฏิเสธในฐานข้อมูล_');
  }
  lines.push('');

  lines.push('## 4) ข้อค้นพบและคำแนะนำเชิงวิเคราะห์ (Insights)');
  if (report.insights.length) {
    for (const ins of report.insights) lines.push(`- ${ins}`);
  } else {
    lines.push('- ข้อมูลยังน้อยในวันที่เลือก หรือคำตอบที่ผู้เล่นเสนอส่วนใหญ่ถูกครอบคลุมในคลังปัจจุบันแล้ว');
  }

  return lines.join('\n');
}
