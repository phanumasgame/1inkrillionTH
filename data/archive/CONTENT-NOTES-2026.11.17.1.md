# Question bank content notes

Reviewed: 17 November 2026. Bank version: `2026.11.17.1`.

The bank contains **21 prompts, 15 Thai and 6 world/general prompts, with 213 accepted answer records**. Each prompt has at least 6 answers and exactly one designated 100-point answer. Answer spelling aliases are reviewed intent matches, not extra answers.

## Sources verified

- Thai province names: [Office of the Public Sector Development Commission province dataset](https://dataportal.opdc.go.th/th/dataset/province-name-group). The first five geography prompts use spelling predicates, avoiding conflicting regional classifications. The initial-consonant ช prompt explicitly includes เชียงใหม่ and เชียงราย. The นคร prompt explicitly excludes กรุงเทพมหานคร because it is a special administrative area, making its 8-province answer set unambiguous.
- International borders: [Department of Treaties and Legal Affairs, Ministry of Foreign Affairs](https://treaties.mfa.go.th/th/content/ข้อมูลเขตแดน?cate=6384675b4c9fb228d63cfc34). The bank includes all 10 Myanmar-border and all 12 Laos-border provinces. River boundaries count; proximity and trade routes alone do not.
- Andaman coast: [Department of Marine and Coastal Resources](https://km.dmcr.go.th/c_1/s_342/d_18009), exactly 6 provinces.
- World Heritage: [UNESCO Thailand property list and inscription years](https://whc.unesco.org/en/statesparties/th/). The prompt is explicitly frozen at the end of **2024**, when the 8 included entries had been inscribed. The live UNESCO list now includes a 2026 inscription; that is intentionally outside this dated prompt.
- Intangible heritage: [UNESCO Thailand elements](https://ich.unesco.org/en/state/thailand-TH?cp=TH&info=elements-on-the-lists&topic=en-state), all 6 entries inscribed through 2024. This includes the multinational Kebaya nomination. Pending nominations are excluded. This is a different UNESCO list from World Heritage sites.
- Consonant classes: [DLTV teaching sheet](https://dltv.ac.th/utils/files/download/61571), complete middle (9), high (11), and low (24) sets. Obsolete-in-everyday-use letters remain in the alphabet and count.
- Thai zodiac: [Fine Arts Department publication](https://www.finearts.go.th/storage/contents/2023/11/file/Iafk0UuQ2W9DHtC02gyoKsBNqRjcb0e8ryzEGbHW.pdf). The prompt asks for the **year names**, not their associated animals.
- Ramwong: [Fine Arts Department, Nan National Museum](https://www.finearts.go.th/nanmuseum/view/6954-รำวงมาตรฐาน), all 10 song titles. No song lyrics are reproduced. รำมาซิมารำ is an accepted colloquial spelling alias of the official title รำซิมารำ.
- Planets: [NASA](https://science.nasa.gov/solar-system/planets/), all 8 major planets, excluding dwarf planets.
- Elements: [IUPAC periodic table](https://iupac.org/what-we-do/periodic-table-of-elements/), all 14 one-letter element symbols and all 7 Group 18 elements. The Group 18 prompt uses group membership rather than asserting that every member is physically a gas at room temperature. D and T are isotope symbols and are excluded.
- SI: [BIPM](https://www.bipm.org/en/measurement-units/si-base-units), all 7 base units; derived units are excluded.
- NATO: [NATO History](https://www.nato.int/en/about-us/nato-history/history-by-theme/symbols-of-nato/nato-phonetic-alphabet), the 12 current code words for A–L. Official spellings are Alfa and Juliett; Alpha and Juliet are accepted spelling aliases. Historical code words such as Coca are excluded.
- ASEAN: [ASEAN Annual Report 2024](https://asean.org/wp-content/uploads/2024/12/ASEAN-AR-2024_e-pub_web.pdf), the 10 member states at that date. The prompt explicitly says end of **2024**. Timor-Leste's subsequent accession in 2025 does not change this dated question.

## Familiarity evidence and limitations

Tiers in this initial bank are **editorial familiarity estimates**, with a reason attached to every answer. They are not survey percentages, measured human recognition rates, or an assertion about the entire Thai population. The designated Krillion answer is an editorial choice and is not necessarily the mathematically least frequent answer.

Wikipedia page-view evidence is a separate enrichment step. Canonical Thai Wikipedia titles were checked through the public MediaWiki query API with redirects enabled on 17 November 2026. All 124 unique mapped titles resolve after the reviewed corrections. Letter-only prompts, song titles, and NATO code words deliberately have `wikiTitle: null` where a page would be absent or measure the wrong entity. Missing coverage must not automatically receive a rare tier.

The bank has exhaustive answer membership for its bounded sets, but its aliases cannot enumerate every possible spelling or transliteration. An unrecognized input should therefore be described as not found in the current bank, rather than proof that a real-world fact is false. Changes to a question's scope require a new `questionVersion`; score/evidence updates require a new bank version.

## Measured evidence snapshot

`data/evidence.json` was last generated at **2026-11-17T05:03:33.010Z** from the Wikimedia Analytics API, using `th.wikipedia.org / all-access / user / monthly`. Its window is **1 November 2025 through 31 October 2026**, the 12 fully completed UTC months before the review date.

- **124 of 124 unique mapped articles** returned all 12 required months: 124 `ok`, 0 `missing`, 0 `error`.
- This covers **147 of 213 answer records**. The remaining 66 are the 44 consonant answers, 10 song titles, and 12 NATO code words intentionally without a page-view proxy.
- Every total and median was independently recomputed from the stored month rows. An even-sized median is the mean of the middle two values.
- These are article views classified as user traffic, not unique people, recognizability percentages, or game-answer frequencies. The API's data is [CC0](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html).
- Regenerate with `npm run refresh-data`, or reproduce this period with `npm run refresh-data -- --as-of=2026-11-17`. The script honors HTTP 429 Retry-After and reports progress; a full refresh can take several minutes. It never rewrites answer tiers.

### Cases requiring editorial judgment

The snapshot supports keeping human review rather than turning article rank directly into a score:

- In the Laos-border question, **พิษณุโลก** has **3,989.5** median monthly views, second highest among the 12 candidates, while **อำนาจเจริญ** has **2,378**. The familiarity of a province name differs from familiarity with its border relationship. The existing designated gem was retained; this is a review point, not a claim that its name is least viewed.
- In the dated World Heritage question, **ภูพระบาท** has **840.5** median monthly views while **กลุ่มป่าแก่งกระจาน** has **128.5**. A designated gem can be selected for the satisfying fact that it entered the list in the cutoff year, even when another valid answer has fewer views.

No score was automatically changed in response to these comparisons.

## Canonical entity review

The mapped titles were reviewed using batched MediaWiki queries for `pageprops.disambiguation`, Wikidata descriptions, and introductory extracts. The final 124 article mappings exclude disambiguation pages and use the intended entities. No article text or unreviewed Wikidata description is used to establish answer correctness; the primary sources above remain the factual references.

- **Earth:** the initial title `โลก` was the World concept (**Q16502**), not the planet. It was replaced with canonical `โลก (ดาวเคราะห์)` (**Q2**), verified as the third planet from the Sun and not a disambiguation page. Only this replacement article was fetched again from AQS. Its actual median is **2,659.5** monthly views and annual total is **34,813**. The former 591-view World record and the earlier low-view Earth example were removed as an invalid proxy; they must not be cited as evidence about planet familiarity.
- **Nora:** both `โนรา` (**Q13026745**) and `มโนราห์` (**Q13019088**) are disambiguation pages. The arts-specific link resolves to canonical `มโนราห์ (รำ)` (**Q6817305**), whose extract explicitly describes the southern Thai performing art also called Nora. The ambiguous record was replaced with one AQS request for this art-specific article: median **1,219** monthly views, annual total **14,948**.
- The other seven planet titles explicitly describe the astronomical planets, not weekdays or deities. All 12 zodiac titles describe the corresponding zodiac years. Songkran, Khon, Thai massage, Tomyum Kung, and Kebaya were checked as their intended festival/performance/practice/food/clothing subjects.
- The World Heritage serial-site titles describe the whole listed groups where a group article exists; the historical-park articles identify the intended heritage locations. They are not unrelated province-name pages.

Both replacement records have all 12 required months. Coverage remains **124 unique articles / 147 of 213 answer records**, with no tier changes and the same bank version identity. No full AQS refresh was repeated for this correction.


