---
name: daily-analysis
description: >-
  Run, research, and analyze the Krillion TH Postgres database daily report whenever
  the user types "วิเคราะห์รายวัน", splitting qualifying candidates into New Answers
  (with evidence-backed rarity tiers) vs New Aliases via Wikipedia, Wikidata, and web search.
---

# วิเคราะห์รายวัน (Krillion TH Daily Database Analysis + Candidate Research)

Use this skill immediately whenever the user says **`วิเคราะห์รายวัน`** (optionally with a specific date like `วิเคราะห์รายวัน 2026-11-20`).

## Steps

1. Run the daily analytics report **with automated Wikipedia & Wikidata research**:
   ```powershell
   node scripts/daily-analysis.mjs --research --format=json
   ```
   - Or run `npm run daily-research` for Markdown output; pass `--date=YYYY-MM-DD` for a specific Thailand date (`Asia/Bangkok`).

2. For EVERY item in `recommendations.newAnswers` and `recommendations.newAliases` (and especially items with `evidenceSummary.needsWebVerify === true`, Thai colloquialisms/slang, cross-category edge cases, or unclear status):
   - Use **`search_web`** (or cross-check `data/survey-bank.json`) to verify:
     1. **เหมาะจะเป็น `answer` ไหม?** Does the entity truly belong to that question's scope and prompt rules, without duplicating an existing answer? Compare popularity (`wpPv`, `wdSitelinks`, Thai prevalence via web search) against the existing answers in that question to judge **ควรอยู่ระดับไหน (`plankton`, `schooler`, `rare`, `deepcut`, `krillion`)** with cited evidence!
     2. **เหมาะจะเป็น `alias` ไหม?** Is it actually another common Thai/English name, nickname, short name, or spelling variant for an existing answer (e.g., `ไจเอ้น` -> `โกดะ ทาเคชิ`, `วัดบวรนิเวศวิหาร` -> `วัดบวรนิเวศ`, `ซาบะ` -> `ปลาซาบะ`)? Or is it off-scope / wrong category (`หมอชิต` in `th-mrt-blue`, coat pattern `สลิด` vs genetic cat breed, folklore `ปลาบู่ทอง` vs real fish) that should be flagged for review or moved to `Skip`?

3. Summarize all database tables (`dive_sessions`, `round_attempts`, `answer_suggestions`, `rejected_guesses`) in Thai using four clear sections:
   - **1. ภาพรวมการเล่น & สมดุลความยาก (`dive_sessions` & `round_attempts`)**
   - **2. คำตอบหลักใหม่ที่แนะนำ (`New Answer` — ผ่าน Research แล้ว)**: สำหรับแต่ละคำ ระบุชัดเจนว่า **เหมาะเป็น Answer ไหม** (`ใช่ / ควรระวัง / ไม่เหมาะ`), **ชื่อหลัก + Aliases ที่แนะนำ**, **ระดับที่ควรอยู่ (`tier`) พร้อมเหตุผล/ตัวเลขจาก Research** (`THWP pageviews`, `Wikidata sitelinks`, หรือผลค้นเว็บ)
   - **3. คำเรียกอื่นที่แนะนำ (`New Alias` — ผ่าน Research แล้ว)**: ระบุชัดเจนว่า **เหมาะเป็น Alias ไหม**, **Alias ใหม่ → คำหลักในคลัง (`targetLabel` · `tier`)**, และหลักฐานยืนยัน (เช่น redirect บนวิกิพีเดียหรือความหมายตรงกัน)
   - **4. รายการไม่เข้าเกณฑ์ / ผิดหมวด & ข้อเสนอแนะเชิงวิเคราะห์ (`Skip / Out of scope` + Insights)**

4. Wait for user approval (or apply immediately if the user asks) before modifying `data/survey-bank.json`. Only state facts, pageviews, sitelinks, and web results directly observed in this turn's tool outputs.
