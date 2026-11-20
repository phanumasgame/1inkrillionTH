# Krillion TH Workspace Instructions

- When the user types **`วิเคราะห์รายวัน`** (or asks for a daily analytics summary from the database), activate the `daily-analysis` skill at [.agents/skills/daily-analysis/SKILL.md](.agents/skills/daily-analysis/SKILL.md) and run `npm run daily-report` (or pass `--date=YYYY-MM-DD` / `--format=json` when specified), then summarize and analyze all Postgres tables (`dive_sessions`, `round_attempts`, `answer_suggestions`, `rejected_guesses`) in Thai for the user — ALWAYS listing qualifying missing candidates split clearly into **New Answers (`answer`)** vs **New Aliases (`alias`)** (reviewing phonetic nicknames / cross-line items accurately).
- Never print or expose secrets from `.env.local` (`DATABASE_URL`, `ADMIN_TOKEN`).
