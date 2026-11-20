---
name: daily-analysis
description: >-
  Run and analyze the Krillion TH Postgres database daily report whenever the user
  types "วิเคราะห์รายวัน" or asks to summarize gameplay sessions, round difficulty,
  player suggestions, and rejected guesses across all database tables, always
  separating qualifying additions into New Answers vs New Aliases.
---

# วิเคราะห์รายวัน (Krillion TH Daily Database Analysis)

Use this skill immediately whenever the user says **`วิเคราะห์รายวัน`** (optionally with a specific date like `วิเคราะห์รายวัน 2026-11-20`).

## Steps

1. Run the read-only daily analytics script against Neon Postgres (loads `.env.local` automatically without printing credentials):
   ```powershell
   npm run daily-report -- --format=json
   ```
   - To inspect a specific Thailand date (`Asia/Bangkok`), pass `--date=YYYY-MM-DD`.
   - For direct Markdown output, run `npm run daily-report`.

2. Never read, print, or expose `DATABASE_URL` or `ADMIN_TOKEN` from `.env.local`.

3. Review the `recommendations` (`newAnswers`, `newAliases`, `reviewOrSkip`) semantically before presenting them:
   - Check if any item placed in `newAnswers` is actually a **phonetic/colloquial nickname alias** of an existing answer in that question (for example `ไจเอ้น` → alias of `โกดะ ทาเคชิ` in `world-cartoon-characters`, `สลิด` → `แมวลายสลิด`, etc.) — if so, move it to **New Alias** in your summary!
   - Check if any item violates the question's strict boundary (for example `หมอชิต` / `หมอชิด` is BTS, NOT MRT Blue Line in `th-mrt-blue`) — move off-topic / invalid items to **ไม่เข้าเกณฑ์ (Skip/Out of scope)** rather than adding bad data!
   - If the user asks to apply approved items later, apply them cleanly into `data/survey-bank.json` and the builder scripts.

4. Summarize **all database tables** (`dive_sessions`, `round_attempts`, `answer_suggestions`, `rejected_guesses`) clearly in Thai using four required sections:
   - **1. ภาพรวมการเล่น & สมดุลความยาก (`dive_sessions` & `round_attempts`)**: Today vs all-time sessions, unique `client_id` players, Daily vs Endless split, avg/max score, avg depth, Krillion count & rate, skips/timeouts, avg answer time (`ms`), and breakdown by `bank_version`.
   - **2. สรุปสถิติข้อมูลดิบ (`answer_suggestions` & `rejected_guesses`)**: Total vs unique rows, how many are already covered in the current `survey-bank.json` vs missing.
   - **3. รายการคำที่เข้าเกณฑ์ควรเพิ่ม — แยกเป็น Answer กับ Alias (REQUIRED EVERY RUN)**:
     - **หมวด A · คำตอบหลักใหม่ (`New Answer`)**: ตารางระบุ `question_id`, `label` ที่แนะนำ, `aliases` พ่วง, `tier` แนะนำ และที่มา (`survey` / `rejected`)
     - **หมวด B · คำเรียกอื่น (`New Alias`)**: ตารางระบุ `question_id`, `alias ใหม่`, `ผูกกับคำหลักเดิม (label · tier)` และเหตุผล (`ตัดคำนำหน้า`, `ชื่อย่อวัด`, `คำสะกด/ชื่อเรียกยอดนิยม`)
     - **หมวด C · รายการคัดออก / ไม่เข้าเกณฑ์ (`Skip / Review`)**: ตัวอักษรเดี่ยว, คำพิมพ์ซ้ำ/พิมพ์ผิด, หรือคำผิดสาย/ผิดหมวด พร้อมเหตุผลสั้น ๆ
   - **4. ข้อค้นพบและคำแนะนำเชิงวิเคราะห์ (Insights & Next Actions)**: Actionable balance, UX, and curation recommendations.

5. Only report numbers, prompts, and database statuses directly observed in the current run.
