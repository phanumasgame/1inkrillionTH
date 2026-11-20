---
name: daily-analysis
description: >-
  Run and analyze the Krillion TH Postgres database daily report whenever the user
  types "วิเคราะห์รายวัน" or asks to summarize gameplay sessions, round difficulty,
  player suggestions, and rejected guesses across all database tables.
---

# วิเคราะห์รายวัน (Krillion TH Daily Database Analysis)

Use this skill immediately whenever the user says **`วิเคราะห์รายวัน`** (optionally with a specific date like `วิเคราะห์รายวัน 2026-11-20` or `วิเคราะห์รายวัน ย้อนหลัง`).

## Steps

1. Run the read-only daily analytics script against Neon Postgres (loads `.env.local` automatically without printing credentials):
   ```powershell
   npm run daily-report -- --format=json
   ```
   - To inspect a specific Thailand date (`Asia/Bangkok`), pass `--date=YYYY-MM-DD`.
   - For direct human-readable Markdown output, run `npm run daily-report`.

2. Never read, print, or expose `DATABASE_URL` or `ADMIN_TOKEN` from `.env.local`.

3. Summarize **all database tables** (`dive_sessions`, `round_attempts`, `answer_suggestions`, `rejected_guesses`) clearly in Thai using four sections:
   - **1. ภาพรวมรอบเล่น (`dive_sessions` & `round_attempts`)**: Today's sessions vs all-time, unique `client_id` players, Daily vs Endless split, avg/max score, avg depth, Krillion rate, skips/timeouts, avg answer time (`ms`), and breakdown by `bank_version`.
   - **2. ข้อเสนอคำตอบจาก Survey (`answer_suggestions`)**: Total vs unique suggestions, cross-checked against current `data/survey-bank.json` (`MISSING` vs `CLOSE` vs `COVERED`). Highlight top `MISSING` items ready to add to the next bank release.
   - **3. คำที่ผู้เล่นพิมพ์แล้วไม่ผ่าน (`rejected_guesses`)**: Most frequent rejected guesses, identifying whether players meant an alias (`CLOSE`), a new answer (`MISSING`), or a cross-category confusion (e.g. an animated movie guessed in general movies).
   - **4. สรุปวิเคราะห์ & ข้อเสนอแนะ (Insights & Action Plan)**: Actionable recommendations for game balance (too-easy Krillions or high-timeout questions), aliases to add, and new answers to curate.

4. Only report numbers, prompts, and statuses directly observed in the script output for that run.
