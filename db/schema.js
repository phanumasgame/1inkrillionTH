export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS answer_suggestions (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    question_id TEXT NOT NULL,
    question_prompt TEXT NOT NULL DEFAULT '',
    suggested_answer TEXT NOT NULL,
    normalized_answer TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'survey',
    bank_version TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'daily',
    session_id TEXT NOT NULL DEFAULT '',
    client_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_answer_suggestions_q_norm ON answer_suggestions (question_id, normalized_answer)`,
  `CREATE INDEX IF NOT EXISTS idx_answer_suggestions_created ON answer_suggestions (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS dive_sessions (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL,
    daily_date TEXT NOT NULL DEFAULT '',
    bank_version TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL DEFAULT 0,
    depth INTEGER NOT NULL DEFAULT 0,
    gems SMALLINT NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dive_sessions_created ON dive_sessions (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS round_attempts (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT NOT NULL,
    client_id TEXT NOT NULL DEFAULT '',
    bank_version TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'daily',
    round_index SMALLINT NOT NULL,
    question_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    answer_id TEXT NOT NULL DEFAULT '',
    answer_label TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT '',
    points SMALLINT NOT NULL DEFAULT 0,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    rejected_inputs JSONB NOT NULL DEFAULT '[]'::jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS idx_round_attempts_q_outcome ON round_attempts (question_id, outcome)`,
  `CREATE INDEX IF NOT EXISTS idx_round_attempts_session ON round_attempts (session_id)`,
  `CREATE TABLE IF NOT EXISTS rejected_guesses (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT NOT NULL,
    client_id TEXT NOT NULL DEFAULT '',
    bank_version TEXT NOT NULL DEFAULT '',
    question_id TEXT NOT NULL,
    raw_input TEXT NOT NULL,
    normalized_input TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rejected_guesses_q_norm ON rejected_guesses (question_id, normalized_input)`,
  `CREATE INDEX IF NOT EXISTS idx_rejected_guesses_created ON rejected_guesses (created_at DESC)`,
];

let schemaReadyPromise = null;

export async function ensureSchema(sql, { force = false } = {}) {
  if (!force && schemaReadyPromise) return schemaReadyPromise;
  const run = (async () => {
    for (const statement of SCHEMA_STATEMENTS) {
      await sql.query(statement);
    }
  })();
  if (!force) {
    schemaReadyPromise = run.catch(err => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  return run;
}

export function resetSchemaCache() {
  schemaReadyPromise = null;
}
