const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n || 0).toLocaleString('en-US');
const TOKEN_KEY = 'krillion-admin-token';

const TIER_COLORS = {
  plankton: '#88b0c5',
  schooler: '#4cdbf1',
  rare: '#72e6b0',
  deepcut: '#c8a1f1',
  krillion: '#ffe387',
  skip: '#6c8194',
  timeout: '#f55388',
  unknown: '#7d92a6',
};

export function mountAdminBackoffice(root, { version = '1.1.0', onToast = () => {} } = {}) {
  let token = '';
  try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch {}
  let data = null;
  let loading = false;
  let error = '';
  let activeTab = 'overview';
  let days = 14;
  let searchQ = '';
  let qSort = 'plays';
  let sugFilter = 'pending';

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: 'Bearer ' + token,
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const err = new Error(json.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function refresh() {
    if (!token) { render(); return; }
    loading = true;
    error = '';
    render();
    try {
      data = await api(`/api/admin?days=${days}&limit=200`);
    } catch (err) {
      error = err.status === 401 ? 'รหัส ADMIN_TOKEN ไม่ถูกต้อง' : err.message;
      if (err.status === 401) {
        token = '';
        try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
      }
    } finally {
      loading = false;
      render();
    }
  }

  async function downloadCsv(view) {
    try {
      const res = await fetch(`/api/suggestions?view=${encodeURIComponent(view)}&format=csv&limit=2000`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) throw new Error('ดาวน์โหลด CSV ไม่สำเร็จ');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `krillion-${view}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      onToast('ดาวน์โหลด CSV เรียบร้อยแล้ว');
    } catch (err) {
      onToast(err.message);
    }
  }

  function renderLogin() {
    root.innerHTML =
      '<main class="admin-shell">' +
        '<section class="admin-login">' +
          '<div class="admin-brand">KRILLION TH · BACKOFFICE</div>' +
          '<h1>Admin Analytics</h1>' +
          '<p class="thai">เข้าสู่ระบบหลังบ้านด้วย <code>ADMIN_TOKEN</code> เพื่อดูภาพรวม สถิติผู้เล่น ข้อเสนอคำตอบ และคำที่พิมพ์ไม่พบ</p>' +
          (error ? '<div class="admin-error">' + esc(error) + '</div>' : '') +
          '<form id="admin-login-form" class="admin-login-form">' +
            '<input id="admin-token-input" type="password" autocomplete="current-password" placeholder="วาง ADMIN_TOKEN ที่นี่..." required>' +
            '<button type="submit" class="primary-button">UNLOCK BACKOFFICE →</button>' +
          '</form>' +
          '<div class="admin-login-foot"><a class="small-link" href="/">← กลับหน้าเกมหลัก</a></div>' +
        '</section>' +
      '</main>';

    document.getElementById('admin-login-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('admin-token-input');
      const val = input?.value?.trim() || '';
      if (!val) return;
      token = val;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
      refresh();
    });
  }

  function renderOverviewTab() {
    const s = data.sessions?.overview || {};
    const r = data.rounds?.overview || {};
    const sg = data.suggestions?.counts || {};
    const rj = data.rejected?.counts || {};
    const trend = [...(data.sessions?.dailyTrend || [])].reverse();
    const maxTrend = Math.max(1, ...trend.map(x => Number(x.sessions) || 0));
    const tiers = data.rounds?.tiers || [];
    const totalRounds = Math.max(1, Number(r.total_rounds) || 1);
    const todayHitPct = r.today_rounds ? ((r.today_hits / r.today_rounds) * 100).toFixed(1) : '0.0';
    const totalHitPct = r.total_rounds ? ((r.total_hits / r.total_rounds) * 100).toFixed(1) : '0.0';

    return '<section class="admin-kpi-grid">' +
      kpiCard('DIVES TODAY', num(s.today_sessions), `ผู้เล่น ${num(s.today_players)} คน · สะสม ${num(s.total_sessions)} รอบ`) +
      kpiCard('HIT RATE TODAY', todayHitPct + '%', `สะสม ${totalHitPct}% · ข้าม ${num(r.total_skips)} / หมดเวลา ${num(r.total_timeouts)}`) +
      kpiCard('AVG DEPTH TODAY', num(s.today_avg_depth) + 'm', `คะแนนเฉลี่ย ${s.today_avg_score || 0} (สูงสุด ${num(s.today_max_score)})`) +
      kpiCard('AVG ANSWER TIME', ((r.today_avg_ms || 0) / 1000).toFixed(1) + 's', `เฉลี่ยสะสม ${((r.total_avg_ms || 0) / 1000).toFixed(1)}s`) +
      kpiCard('KRILLIONS', num(s.today_gems) + ' 🌟', `สะสมทั้งหมด ${num(s.total_gems)} คริลเลียน`) +
      kpiCard('QUEUE / MISSES', num(sg.pending_rows), `Survey ค้างตรวจ ${num(sg.pending_rows)} · คำไม่ซ้ำ ${num(rj.unique_misses)}`) +
    '</section>' +
    '<div class="admin-two-col">' +
      '<article class="admin-panel">' +
        '<h3>แนวโน้มจำนวนการเล่น (' + days + ' วันล่าสุด)</h3>' +
        (trend.length
          ? '<div class="admin-bars">' + trend.map(d => {
              const h = Math.max(6, Math.round(((d.sessions || 0) / maxTrend) * 110));
              return '<div class="admin-bar-col" title="' + esc(d.day) + ': ' + d.sessions + ' รอบ (' + d.players + ' ผู้เล่น, เฉลี่ย ' + d.avg_score + ' แต้ม)">' +
                '<small>' + num(d.sessions) + '</small>' +
                '<div class="admin-bar-fill" style="height:' + h + 'px"></div>' +
                '<span>' + esc(String(d.day).slice(5)) + '</span></div>';
            }).join('') + '</div>'
          : '<p class="admin-empty">ยังไม่มีข้อมูลในช่วงเวลานี้</p>') +
      '</article>' +
      '<article class="admin-panel">' +
        '<h3>สัดส่วนระดับคำตอบ (Round Outcomes)</h3>' +
        '<div class="admin-tier-list">' + tiers.map(t => {
          const pct = ((t.total_count / totalRounds) * 100).toFixed(1);
          const col = TIER_COLORS[t.bucket] || '#6fb7d6';
          return '<div class="admin-tier-row">' +
            '<div class="admin-tier-head"><span style="color:' + col + '">' + esc(String(t.bucket).toUpperCase()) + '</span>' +
            '<small>วันนี้ ' + num(t.today_count) + ' · รวม ' + num(t.total_count) + ' (' + pct + '%) · ' + ((t.avg_ms || 0) / 1000).toFixed(1) + 's</small></div>' +
            '<div class="admin-tier-track"><i style="width:' + pct + '%;background:' + col + '"></i></div>' +
          '</div>';
        }).join('') + '</div>' +
      '</article>' +
    '</div>' +
    '<article class="admin-panel" style="margin-top:14px">' +
      '<h3>แยกตามเวอร์ชันคลังคำตอบ</h3>' +
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Bank Version</th><th>Today</th><th>All-Time</th><th>Players</th><th>Avg Score</th><th>Krillions</th></tr></thead><tbody>' +
      (data.sessions?.byVersion || []).map(v =>
        '<tr><td><code>v' + esc(v.bank_version) + '</code></td><td>' + num(v.today_sessions) + '</td><td>' + num(v.sessions) +
        '</td><td>' + num(v.players) + '</td><td>' + esc(v.avg_score) + '</td><td>' + num(v.gems) + '</td></tr>'
      ).join('') +
      '</tbody></table></div>' +
    '</article>';
  }

  function renderQuestionsTab() {
    const q = searchQ.toLowerCase();
    const rows = [...(data.rounds?.byQuestion || [])]
      .filter(r => !q || r.questionId.toLowerCase().includes(q) || r.prompt.toLowerCase().includes(q) || r.theme.toLowerCase().includes(q))
      .sort((a, b) => {
        if (qSort === 'miss') return b.missRatePct - a.missRatePct || b.plays - a.plays;
        if (qSort === 'rejected') return b.avgRejected - a.avgRejected || b.plays - a.plays;
        if (qSort === 'slow') return b.avgMs - a.avgMs;
        if (qSort === 'lowpts') return a.avgPoints - b.avgPoints;
        return b.plays - a.plays || b.todayPlays - a.todayPlays;
      });

    return '<div class="admin-controls-row">' +
      '<input type="search" id="admin-search" placeholder="ค้นหารหัสโจทย์ ชื่อหมวด หรือคำถาม..." value="' + esc(searchQ) + '">' +
      '<select id="admin-qsort">' +
        '<option value="plays"' + (qSort === 'plays' ? ' selected' : '') + '>เรียง: เล่นมากสุด</option>' +
        '<option value="miss"' + (qSort === 'miss' ? ' selected' : '') + '>เรียง: พลาดสูงสุด (%)</option>' +
        '<option value="rejected"' + (qSort === 'rejected' ? ' selected' : '') + '>เรียง: พิมพ์ไม่ผ่านเฉลี่ย</option>' +
        '<option value="slow"' + (qSort === 'slow' ? ' selected' : '') + '>เรียง: ใช้เวลาคิดนาน</option>' +
        '<option value="lowpts"' + (qSort === 'lowpts' ? ' selected' : '') + '>เรียง: คะแนนเฉลี่ยน้อยสุด</option>' +
      '</select>' +
    '</div>' +
    '<article class="admin-panel"><div class="admin-table-wrap"><table class="admin-table">' +
      '<thead><tr><th>Question</th><th>Theme</th><th>Pool</th><th>Plays (Today)</th><th>Miss %</th><th>Avg Pts</th><th>Avg Sec</th><th>Rej/Round</th><th>🌟</th></tr></thead><tbody>' +
      rows.slice(0, 150).map(r =>
        '<tr>' +
          '<td><strong>' + esc(r.prompt) + '</strong><br><small><code>' + esc(r.questionId) + '</code></small></td>' +
          '<td><span class="admin-pill">' + esc(r.scope) + ' · ' + esc(r.theme) + '</span></td>' +
          '<td>' + num(r.poolSize) + '</td>' +
          '<td>' + num(r.plays) + ' <small>(' + num(r.todayPlays) + ')</small></td>' +
          '<td style="color:' + (r.missRatePct >= 50 ? '#ff8aa8' : '#bce8f7') + '">' + r.missRatePct + '%</td>' +
          '<td>' + r.avgPoints + '</td>' +
          '<td>' + (r.avgMs / 1000).toFixed(1) + 's</td>' +
          '<td>' + r.avgRejected + '</td>' +
          '<td>' + num(r.krillions) + '</td>' +
        '</tr>'
      ).join('') +
    '</tbody></table></div></article>';
  }

  function renderSuggestionsTab() {
    const q = searchQ.toLowerCase();
    const list = (data.suggestions?.items || []).filter(item => {
      if (sugFilter !== 'all' && item.status !== sugFilter) return false;
      if (!q) return true;
      return item.question_id.toLowerCase().includes(q) ||
        (item.prompt || '').toLowerCase().includes(q) ||
        (item.sample_answer || '').toLowerCase().includes(q) ||
        (item.notes || '').toLowerCase().includes(q);
    });

    return '<div class="admin-controls-row">' +
      '<input type="search" id="admin-search" placeholder="ค้นหาคำเสนอ, โจทย์, หรือหมายเหตุ..." value="' + esc(searchQ) + '">' +
      '<select id="admin-sugfilter">' +
        '<option value="pending"' + (sugFilter === 'pending' ? ' selected' : '') + '>เฉพาะ Pending (' + num(data.suggestions?.counts?.pending_rows) + ')</option>' +
        '<option value="added"' + (sugFilter === 'added' ? ' selected' : '') + '>เฉพาะ Added (' + num(data.suggestions?.counts?.added_rows) + ')</option>' +
        '<option value="ignored"' + (sugFilter === 'ignored' ? ' selected' : '') + '>เฉพาะ Ignored (' + num(data.suggestions?.counts?.ignored_rows) + ')</option>' +
        '<option value="all"' + (sugFilter === 'all' ? ' selected' : '') + '>แสดงทั้งหมด</option>' +
      '</select>' +
      '<button type="button" class="secondary-button" data-csv="summary">⬇ CSV Summary</button>' +
    '</div>' +
    '<article class="admin-panel"><div class="admin-table-wrap"><table class="admin-table">' +
      '<thead><tr><th>คำที่เสนอ</th><th>โจทย์</th><th>จำนวน</th><th>Notes</th><th>Status</th><th>Manage</th></tr></thead><tbody>' +
      (list.length ? list.map(item =>
        '<tr>' +
          '<td><strong>' + esc(item.sample_answer) + '</strong><br><small>v' + esc(item.latest_version) + '</small></td>' +
          '<td>' + esc(item.prompt) + '<br><small><code>' + esc(item.question_id) + '</code></small></td>' +
          '<td>' + num(item.total_count) + (item.today_count ? ' <small>(วันนี้ +' + item.today_count + ')</small>' : '') + '</td>' +
          '<td><small>' + esc(item.notes || '-') + '</small></td>' +
          '<td><span class="admin-status is-' + esc(item.status) + '">' + esc(item.status) + '</span></td>' +
          '<td class="admin-actions-cell">' +
            '<button type="button" class="admin-mini-btn is-add" data-sug-status="added" data-qid="' + esc(item.question_id) + '" data-norm="' + esc(item.normalized_answer) + '">✓ Added</button>' +
            '<button type="button" class="admin-mini-btn is-ign" data-sug-status="ignored" data-qid="' + esc(item.question_id) + '" data-norm="' + esc(item.normalized_answer) + '">✕ Ignore</button>' +
            (item.status !== 'pending' ? '<button type="button" class="admin-mini-btn" data-sug-status="pending" data-qid="' + esc(item.question_id) + '" data-norm="' + esc(item.normalized_answer) + '">↺</button>' : '') +
          '</td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="6" class="admin-empty">ไม่มีรายการในสถานะนี้</td></tr>') +
    '</tbody></table></div></article>';
  }

  function renderRejectedTab() {
    const q = searchQ.toLowerCase();
    const list = (data.rejected?.items || []).filter(item =>
      !q || item.question_id.toLowerCase().includes(q) ||
      (item.prompt || '').toLowerCase().includes(q) ||
      (item.sample_input || '').toLowerCase().includes(q)
    );

    return '<div class="admin-controls-row">' +
      '<input type="search" id="admin-search" placeholder="ค้นหาคำที่ผู้เล่นพิมพ์ไม่ผ่านหรือรหัสโจทย์..." value="' + esc(searchQ) + '">' +
      '<button type="button" class="secondary-button" data-csv="rejected">⬇ CSV Rejected</button>' +
    '</div>' +
    '<article class="admin-panel"><div class="admin-table-wrap"><table class="admin-table">' +
      '<thead><tr><th>คำที่พิมพ์</th><th>โจทย์</th><th>Miss Count</th><th>Version</th><th>Manage</th></tr></thead><tbody>' +
      (list.length ? list.map(item =>
        '<tr>' +
          '<td><strong>' + esc(item.sample_input) + '</strong></td>' +
          '<td>' + esc(item.prompt) + '<br><small><code>' + esc(item.question_id) + '</code></small></td>' +
          '<td>' + num(item.miss_count) + (item.today_count ? ' <small>(วันนี้ +' + item.today_count + ')</small>' : '') + '</td>' +
          '<td><small>v' + esc(item.latest_version) + '</small></td>' +
          '<td><button type="button" class="admin-mini-btn is-ign" data-del-rej="1" data-qid="' + esc(item.question_id) + '" data-norm="' + esc(item.normalized_input) + '">🗑 ลบ</button></td>' +
        '</tr>'
      ).join('') : '<tr><td colspan="5" class="admin-empty">ไม่พบข้อมูล</td></tr>') +
    '</tbody></table></div></article>';
  }

  function renderSessionsTab() {
    const list = data.sessions?.recent || [];
    return '<article class="admin-panel"><div class="admin-table-wrap"><table class="admin-table">' +
      '<thead><tr><th>Time (BKK)</th><th>Mode</th><th>Player</th><th>Score / Depth</th><th>Gems</th><th>Ver</th><th>7 Rounds</th></tr></thead><tbody>' +
      list.map(s => {
        const dt = new Date(s.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const pills = (Array.isArray(s.rounds) ? s.rounds : []).map(r => {
          const col = TIER_COLORS[r.outcome === 'skip' || r.outcome === 'timeout' ? r.outcome : r.tier] || '#6b7e91';
          const title = `${r.questionId}: ${r.label || r.outcome} (${r.points} pts, ${((r.ms || 0) / 1000).toFixed(1)}s)`;
          return '<i class="admin-round-dot" title="' + esc(title) + '" style="background:' + col + '"></i>';
        }).join('');
        return '<tr>' +
          '<td><small>' + esc(dt) + '</small></td>' +
          '<td><span class="admin-pill">' + esc(s.mode) + '</span></td>' +
          '<td><code>' + esc(String(s.client_id || '-').slice(0, 10)) + '</code></td>' +
          '<td><strong>' + num(s.score) + '</strong> · ' + num(s.depth) + 'm</td>' +
          '<td>' + num(s.gems) + ' 🌟</td>' +
          '<td><small>v' + esc(s.bank_version) + '</small></td>' +
          '<td><div class="admin-round-dots">' + pills + '</div></td>' +
        '</tr>';
      }).join('') +
    '</tbody></table></div></article>';
  }

  function kpiCard(label, value, sub) {
    return '<article class="admin-kpi"><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong><span>' + esc(sub) + '</span></article>';
  }

  function render() {
    if (!token) { renderLogin(); return; }
    if (!data && loading) {
      root.innerHTML = '<main class="admin-shell"><div class="admin-loading">กำลังโหลดข้อมูลหลังบ้าน...</div></main>';
      return;
    }
    if (!data) {
      root.innerHTML = '<main class="admin-shell"><div class="admin-error">' + esc(error || 'โหลดข้อมูลไม่สำเร็จ') +
        '</div><button id="admin-retry" class="primary-button">ลองใหม่</button> <button id="admin-logout" class="secondary-button">ออก</button></main>';
      document.getElementById('admin-retry')?.addEventListener('click', refresh);
      document.getElementById('admin-logout')?.addEventListener('click', () => {
        token = ''; try { sessionStorage.removeItem(TOKEN_KEY); } catch {} render();
      });
      return;
    }

    const tabs = [
      ['overview', '📊 ภาพรวม & สถิติ'],
      ['questions', '🎯 สถิติรายข้อ (' + (data.rounds?.byQuestion?.length || 0) + ')'],
      ['suggestions', '💡 ข้อเสนอ (' + num(data.suggestions?.counts?.pending_rows) + ')'],
      ['rejected', '❌ คำที่ไม่พบ (' + num(data.rejected?.counts?.unique_misses) + ')'],
      ['sessions', '🕹️ รอบล่าสุด'],
    ];

    const bodyHtml = activeTab === 'overview' ? renderOverviewTab()
      : activeTab === 'questions' ? renderQuestionsTab()
      : activeTab === 'suggestions' ? renderSuggestionsTab()
      : activeTab === 'rejected' ? renderRejectedTab()
      : renderSessionsTab();

    root.innerHTML =
      '<main class="admin-shell">' +
        '<header class="admin-topbar">' +
          '<div><div class="admin-brand">KRILLION TH · BACKOFFICE · v' + esc(version) + '</div>' +
          '<h1>Dashboard ภาพรวมระบบ</h1></div>' +
          '<div class="admin-top-actions">' +
            '<select id="admin-days">' +
              '<option value="7"' + (days === 7 ? ' selected' : '') + '>7 วัน</option>' +
              '<option value="14"' + (days === 14 ? ' selected' : '') + '>14 วัน</option>' +
              '<option value="30"' + (days === 30 ? ' selected' : '') + '>30 วัน</option>' +
              '<option value="60"' + (days === 60 ? ' selected' : '') + '>60 วัน</option>' +
            '</select>' +
            '<button type="button" class="secondary-button" id="admin-refresh"' + (loading ? ' disabled' : '') + '>↻ รีเฟรช</button>' +
            '<a class="secondary-button" href="/">← กลับหน้าเกม</a>' +
            '<button type="button" class="secondary-button" id="admin-logout">ออก</button>' +
          '</div>' +
        '</header>' +
        '<nav class="admin-tabs">' + tabs.map(([id, label]) =>
          '<button type="button" class="patch-tab' + (activeTab === id ? ' is-active' : '') + '" data-admin-tab="' + id + '">' + esc(label) + '</button>'
        ).join('') + '</nav>' +
        bodyHtml +
      '</main>';

    document.getElementById('admin-days')?.addEventListener('change', e => {
      days = Number(e.target.value) || 14;
      refresh();
    });
    document.getElementById('admin-refresh')?.addEventListener('click', refresh);
    document.getElementById('admin-logout')?.addEventListener('click', () => {
      token = '';
      try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
      render();
    });
    document.getElementById('admin-search')?.addEventListener('input', e => {
      searchQ = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const next = document.getElementById('admin-search');
      if (next) { next.focus(); try { next.setSelectionRange(pos, pos); } catch {} }
    });
    document.getElementById('admin-qsort')?.addEventListener('change', e => { qSort = e.target.value; render(); });
    document.getElementById('admin-sugfilter')?.addEventListener('change', e => { sugFilter = e.target.value; render(); });
  }

  root.addEventListener('click', async e => {
    const tab = e.target.closest('[data-admin-tab]');
    if (tab) { activeTab = tab.dataset.adminTab; render(); return; }
    const csvBtn = e.target.closest('[data-csv]');
    if (csvBtn) { await downloadCsv(csvBtn.dataset.csv); return; }
    const sugBtn = e.target.closest('[data-sug-status]');
    if (sugBtn) {
      sugBtn.disabled = true;
      try {
        await api('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'suggestion-status',
            questionId: sugBtn.dataset.qid,
            normalizedAnswer: sugBtn.dataset.norm,
            status: sugBtn.dataset.sugStatus,
          }),
        });
        onToast('อัปเดตสถานะข้อเสนอแล้ว');
        await refresh();
      } catch (err) {
        onToast(err.message);
        sugBtn.disabled = false;
      }
      return;
    }
    const delBtn = e.target.closest('[data-del-rej]');
    if (delBtn) {
      delBtn.disabled = true;
      try {
        await api('/api/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'delete-rejected',
            questionId: delBtn.dataset.qid,
            normalizedInput: delBtn.dataset.norm,
          }),
        });
        onToast('ลบคำที่พิมพ์ไม่ผ่านออกแล้ว');
        await refresh();
      } catch (err) {
        onToast(err.message);
        delBtn.disabled = false;
      }
    }
  });

  if (token) refresh();
  else render();
}
