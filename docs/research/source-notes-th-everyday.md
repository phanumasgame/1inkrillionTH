# Thai everyday question bank — source and acceptance notes

Authoring date: 2026-11-17. Owned part: outputs/research/parts/th-everyday.json.

This part contains seven replacement Thai-context prompts and 368 distinct accepted answers. It changes no game mechanics, UI, main bank, source fetcher, or tests. The .github/copilot-instructions.md file was checked before authoring and is absent in this checkout.

## What the sources establish

The linked sources establish that the dishes, products, activities, or car brands exist and belong to the intended category. They do not measure what fraction of Thai players will answer them. Tiers and Thai reasons are editorial choices for a prototype, not response statistics. No actual player percentages were invented.

Question-level citations support the category and examples. This is a curated prototype bank, not a claim to have exhaustively crawled every source or checked every answer against a dedicated source paragraph. Exact SKU availability, local names, and brand history can vary; the acceptance rules below deliberately avoid pretending that a single catalog is the whole category.

The parent agent owns the separate Krillion.io sampling and analysis. This file does not claim that this child agent played 500 questions.

## Counts and structural checks

| ID | Accepted answers | Wikipedia entity anchors |
| --- | ---: | ---: |
| th-noodle-dishes | 48 | 3 |
| th-desserts | 60 | 3 |
| th-cold-drinks | 55 | 3 |
| th-convenience-food | 58 | 3 |
| th-snack-brands | 51 | 2 |
| th-childhood-games | 35 | 1 |
| th-car-brands | 61 | 2 |

All seven prompts have five accepted starter labels, one krillion answer, multiple scoring tiers, and nonempty Thai reasons. All six supported tier IDs appear in the part. The part is all scope=thai: this refers to the player context, not the origin of every food or brand.

Validation used the actual answerForms, matchAnswer, and validateBank exports from src/game.js. Every starter matches exactly. No ambiguous alias was found after the same normalization used by the game. Duplicate forms within an individual answer were removed. validateBank reports only "Not enough world questions", expected when validating this Thai-only part in isolation.

## Per-question acceptance and source coverage

### th-noodle-dishes — เมนูเส้นสักจาน!

- Accept a recognizable noodle dish, including Thai, Chinese, Japanese, Vietnamese, Malay/Singaporean and Italian dishes. Do not require an origin country, province, or exact restaurant menu spelling.
- Bare familiar anchors such as ก๋วยเตี๋ยว, ขนมจีน, พาสต้า and สปาเกตตี are accepted. Named preparations such as ก๋วยเตี๋ยวเรือ and ขนมจีนน้ำเงี้ยว are also accepted. This follows ordinary food ordering language rather than forcing a culinary taxonomy exam.
- Core staples include ผัดไทย, ราดหน้า, ผัดซีอิ๊ว, ก๋วยเตี๋ยว, ขนมจีน and ราเมง. The bank also spans soups, dry dishes, stir-fries, salads, and pasta.
- Suan Dusit School of Culinary Arts gives direct culinary teaching evidence for stir-fried noodle dishes. TAT provides official Thai food context. The Michelin article is the publisher’s original culinary explainer; it supports noodle vocabulary and regional dishes, rather than providing player-frequency evidence.
- ก๋วยเตี๋ยวหมูเลียง is the editorial gem because the regional dish offers a satisfying discovery. No measured rarity is asserted.
- Aliases cover กวยจั๊บ/ก๋วยจั๊บ, common transliterations, shorter ordering names, and clear English equivalents. A bare type of raw ingredient is not automatically equivalent to every dish that contains it.

### th-desserts — ขนมไทยสักอย่าง

- Accept a recognizable Thai sweet or dessert name, including the names used at markets and dessert stalls. No auspicious-number checklist, spelling restriction, or royal-era trivia is imposed.
- Suan Dusit course and recipe pages directly support a wide dessert repertoire, including เรไร, บัวลอย and สังขยาใบเตย. TAT supplies additional regional Thai-food context.
- Sixty named answers span steamed, baked, fried, coconut-milk and sticky-rice sweets. The list is curated from known culinary categories; the source list is not a per-answer provenance ledger for all sixty.
- ขนมเรไร/ขนมรังไร is the editorial gem. จ่ามงกุฎ and ดาราทอง are deliberately separate entries; popular confusion between the names is not converted into a false synonym.
- Compound dishes such as ข้าวเหนียวมะม่วง remain distinct from the plain ingredient ข้าวเหนียว. Prefix ขนม and common spelling variants are accepted where they identify the same sweet.

### th-cold-drinks — สั่งน้ำเย็นสักแก้ว เอาอะไรดี?

- Accept non-alcoholic drinks that can be ordered or served cold or blended: water, tea, coffee, milk drinks, juices, herbal drinks and smoothies.
- The current Cafe Amazon /products and /catering pages provide first-party menu evidence for cafe categories and specific drink names. TAT supports local Thai food and drink context. The old menu.aspx path was not used because it does not provide the current usable menu.
- Generic anchors such as กาแฟ, ชา, โกโก้ and น้ำเปล่า are accepted as ordinary orders, alongside specific preparations such as อเมริกาโน, ชาดำเย็น and มะนาวโซดา. Ingredients alone are not treated as arbitrary accepted drinks.
- น้ำใบบัวบก is an editorial gem from a familiar traditional-drink category. Its wikiTitle is null: a plant article would be the wrong popularity entity for the beverage.
- Commercial names that are ordinary orders are accepted where included. For example โค้ก and เป๊ปซี่ map to the น้ำอัดลม entry; this is a gameplay grouping, not a claim that the two brands are synonyms outside this question.
- Tea, coffee and chocolate broad categories have narrower preparations too. This is intentional: the player is recalling a drink, not completing a technical drink-classification exercise.

### th-convenience-food — ของกินในร้านสะดวกซื้อสักอย่าง

- Accept a type of food or snack sold in the Thai convenience-store context. Brand knowledge, a particular chain, a precise SKU, and current stock at a particular branch are not required.
- The retailer’s All Online fresh/frozen category and its own porridge article provide first-party product evidence. CPRAM’s own annual report supports prepared meals and bakery context. The specific retailer product page for ชิโทริ มันหวานอบ establishes the gem as an actual retail food example.
- The bank spans hot meals, rice, noodles, dim sum, bakery, packaged snacks, sweets, frozen desserts, fruit and simple eggs. It is deliberately broader than a list of five ready-meal dishes.
- All Online can sell multipacks and delivery items. An online catalog listing is not evidence that every physical 7-Eleven branch sells that item every day. The prompt and explanation make no such claim.
- Bare categories such as ข้าวกล่อง, ขนมปัง and ผลไม้ are accepted. Specific common items such as กล้วยหอม or ข้าวกะเพรา are also accepted. Generic instant-noodle brands map to บะหมี่กึ่งสำเร็จรูป in this question.
- มันหวาน is the editorial gem. The low-stakes surprise is that convenience-store food includes a simple root vegetable, not only packet snacks.

### th-snack-brands — ยี่ห้อขนมสักยี่ห้อ

- Accept a named snack brand sold or historically sold in Thailand, including packet snacks, biscuits, wafers, chocolate, candy and gum. Nationality and current availability are not constraints.
- BJC investor FAQ directly names เทสโต, ปาร์ตี้, โดโซะ and แคมปัส. Its own 2016 capital-increase document names คารามูโจ้, allowing this historical brand without pretending it is on every current shelf.
- SNNP’s site supports เบนโตะ and โลตัส. Glico’s product pages support ป๊อกกี้ and เพรทซ์. Mondelez country/brand pages support its Thailand-associated chocolate, biscuit, candy and gum brands. PepsiCo provides first-party evidence for its snack brands.
- The retailer catalog is supplementary evidence for the broad Thai shelf context. Its reader access was incomplete (including a 403 response on a catalog page), so this note does not claim a complete successful catalog crawl or per-product verification for all fifty-one brands.
- คารามูโจ้ is the editorial gem with explicit historical first-party support. ปูไทย is the familiar playful answer; it is not rejected merely because it looks like a food description.
- Common Thai spellings, Latin brand names, and punctuation-free versions are accepted where unambiguous. Product flavors are not separate brands. Sub-brand names are retained when consumers recognize them as the product brand.

### th-childhood-games — การละเล่นตอนเด็ก ๆ สักอย่าง

- Accept named playground and traditional childhood games played with people and simple physical equipment, including running, guessing, chanting and hand games. The hint explicitly excludes video games; the explanation excludes generic international sport names.
- DLTV’s word-card PDF directly names ม้าก้านกล้วย, ขี่ม้าส่งเมือง, หมากเก็บ, ซ่อนแอบ, กาฟักไข่, งูกินหาง, รีรีข้าวสาร, เดินกะลา, ขาโถกเถก and ตีวงล้อ. Its matching worksheet includes โพงพาง and เสือข้ามห้วย. Another DLTV sheet describes กระโดดเชือก, กระต่ายขาเดียว and มอญซ่อนผ้า.
- The Thai Sports Association page provides first-party rules for traditional games, including walking on coconut shells and one-leg chase. The DPE document landing page identifies its own 2015 Thai traditional folk-games publication and authoring office. The linked PDF download timed out, so the landing page was used as publication evidence, not falsely described as a fully read book.
- The remaining entries are curated common named games. The provided references establish the category and a substantial set of exact members, not an exhaustive citation for every local variant.
- ซ่อนหา and ซ่อนแอบ are aliases for one answer. ตี่จับ and กระต่ายขาเดียว remain distinct games. กระโดดเชือก and กระโดดยาง are distinct by equipment and manner of play.
- โพงพาง is the editorial gem and is directly listed by DLTV. The common anchors include ซ่อนหา, ไล่จับ, กระโดดยาง, มอญซ่อนผ้า and หมากเก็บ.

### th-car-brands — ยี่ห้อรถยนต์สักยี่ห้อ

- Accept a consumer-facing automobile brand, current or historical, including passenger cars, sports cars, pickups, vans, buses and commercial vehicles. A model-only answer such as Civic or Vios is excluded in the visible hint.
- The prompt does not require Thai origin, current Thai sales, or participation in any particular event. Motor Expo is factual membership evidence, not a hidden answer constraint.
- The organizer’s own 2024 and 2025 announcements directly list the bulk of the accepted brands, including familiar Japanese/European brands, newer EV brands and commercial-vehicle brands. Subaru Thailand independently verifies Subaru.
- Familiar names omitted from those two event lineups were added from manufacturer websites: Chevrolet, Volkswagen, Land Rover, Jaguar, Lamborghini, Bentley, Rolls-Royce, Aston Martin and Renault. Chevrolet’s Thai FAQ expressly says new-car sales ended in 2020, so historical inclusion is intentional.
- The Ferrari Bangkok dealer page timed out in the reader. It was replaced in the source list with Ferrari’s own 2024 annual report, which mentions its brand exhibition in Bangkok. The Thai-Italian Chamber directory also identifies Cavallino Motors as the Thailand representative, but was not needed as the primary source in the question.
- GAC/Aion/Hyptec and Geely/Riddara are accepted as separate consumer-facing brands as in the event announcements. Omoda and Jaecoo are split into their two brand names even though the exhibitor announcement groups them into one display entry.
- แคร์รีบอย is the editorial gem: the 2025 organizer explicitly includes Carryboy among automobile brands. The source has the obvious Latin typo Casrryboy; the bank uses the established brand spelling Carryboy.
- Bare common names such as เบนซ์, บีเอ็ม, มิตซู and โฟล์ค are accepted. Distinct brands are not merged merely because they share a parent company.

## Wikipedia entity choices

Only 17 high-confidence canonical Thai Wikipedia entities are populated; all other wikiTitle fields are null. Public MediaWiki title resolution was checked while authoring. This checks entity identity only; the parent owns fetching popularity evidence and saving source snapshots.

No redirect to an unrelated broad category was used as a popularity proxy. In particular ซ่อนหา was missing under that requested title, and หมากเก็บ resolved to the much broader การละเล่นเด็กไทย article, so both were left null. A plant page was not substituted for the ใบบัวบก drink.

## Exact source links included in the part

### th-noodle-dishes

- [โรงเรียนการเรือน ม.สวนดุสิต: ก๋วยเตี๋ยวผัด](https://food.dusit.ac.th/home/?p=20108)
- [ททท.: อาหารท้องถิ่น](https://thai.tourismthailand.org/Experiences/Details/อาหารท้องถิ่น/16)
- [MICHELIN Guide: เรื่องน่ารู้เกี่ยวกับเส้นก๋วยเตี๋ยว](https://guide.michelin.com/th/th/article/features/use-your-noodle-a-primer-on-thai-noodles)

### th-desserts

- [โรงเรียนการเรือน ม.สวนดุสิต: เมนูขนมไทย](https://food.dusit.ac.th/home/?p=3692)
- [โรงเรียนการเรือน ม.สวนดุสิต: ขนมไทยโบราณ](https://food.dusit.ac.th/home/?p=14505)
- [โรงเรียนการเรือน: ขนมเรไร บัวลอย สังขยาใบเตย](https://food.dusit.ac.th/home/?p=17686)
- [ททท.: อาหารท้องถิ่น](https://thai.tourismthailand.org/Experiences/Details/อาหารท้องถิ่น/16)

### th-cold-drinks

- [Café Amazon: ผลิตภัณฑ์และเครื่องดื่ม](https://www.cafe-amazon.com/products)
- [Café Amazon: เมนูจัดเลี้ยงเครื่องดื่ม](https://www.cafe-amazon.com/catering)
- [ททท.: อาหารท้องถิ่นและเครื่องดื่ม](https://thai.tourismthailand.org/Experiences/Details/อาหารท้องถิ่น/16)

### th-convenience-food

- [ALL Online 7-Eleven: อาหารสดและแช่แข็ง](https://www.allonline.7eleven.co.th/supermarket/fresh-and-frozen-food/?categoryId=141867070&p=0&view=0)
- [ALL Online: โจ๊ก ข้าวตุ๋น ข้าวต้มพร้อมทาน](https://blog.allonline.7eleven.co.th/supermarket/ready-to-eat-porridge-rice-pottage/)
- [ALL Online: มันหวานอบ ชิโทริ](https://www.allonline.7eleven.co.th/p/ชิโทริ-มันหวานอบ-50-กรัม-แพ็ก-10-ชิ้น/325384/)
- [CPRAM: รายงานผลิตภัณฑ์อาหารและขนมพร้อมทาน](https://www.cpram.co.th/th/pdf/Annual%20Report%206-2024%20Aproved%20By%20K%20Wisade.pdf)

### th-snack-brands

- [BJC: แบรนด์อาหารของบริษัท](https://investor.bjc.co.th/th/faqs)
- [BJC: เอกสารกลุ่มผลิตภัณฑ์ขนม เทสโต ปาร์ตี้ โดโซะ คารามูโจ้](https://investor.bjc.co.th/storage/content/shareholder-info/capital-increase/20160721-bjc-capital_increase02-02-th.pdf)
- [SNNP: แบรนด์และผลิตภัณฑ์](https://www.snnp.co.th/)
- [Thai Glico: ป๊อกกี้](https://www.glico.com/th/product/pocky/)
- [Thai Glico: เพรทซ์](https://www.glico.com/th/product/pretz/)
- [Mondelez: แบรนด์ที่จำหน่ายในไทย](https://www.mondelezinternational.com/amea/countries/)
- [Mondelez: Our Brands](https://www.mondelezinternational.com/our-brands/)
- [PepsiCo: Lay’s ในประเทศไทย](https://www.pepsico.com/newsroom/stories/2026/fans-are-no-longer-just-tasting-flavors-they-are-helping-create-them)
- [ALL Online: ขนมในแค็ตตาล็อกค้าปลีก](https://www.allonline.7eleven.co.th/supermarket/)

### th-childhood-games

- [กรมพลศึกษา: การละเล่นพื้นบ้านไทย](https://www.dpe.go.th/en/doc-knowledge-recreation/019f44c9-83de-75c9-96d2-376d5588889f/thai-traditional-folk-games)
- [สมาคมกีฬาไทยแห่งประเทศไทยฯ: กติกากีฬาพื้นบ้าน](https://thaisports.org/thai-folk-rules/)
- [DLTV: บัตรคำการละเล่นต่าง ๆ](https://dltv.ac.th/utils/files/download/62657)
- [DLTV: การละเล่นไทย กระโดดเชือก กระต่ายขาเดียว มอญซ่อนผ้า](https://dltv.ac.th/utils/files/download/208553)
- [DLTV: จับคู่การละเล่นของไทย](https://dltv.ac.th/utils/files/download/8817)

### th-car-brands

- [ผู้จัด Motor Expo: รายชื่อแบรนด์รถยนต์ร่วมงานปี 2025](https://www.motorexpo.co.th/news/5093)
- [ผู้จัด Motor Expo: รายชื่อแบรนด์รถยนต์ร่วมงานปี 2024](https://www.motorexpo.co.th/news/4761)
- [Subaru Thailand: รถยนต์ซูบารุ](https://www.subaru.asia/th/th/)
- [Ferrari: Annual Report 2024 กล่าวถึงกิจกรรมแบรนด์ในกรุงเทพฯ](https://cdn.ferrari.com/download/Ferrari_Annual_Report_2024.pdf)
- [Chevrolet Thailand: ยุติการจำหน่ายรถใหม่และคงบริการหลังการขาย](https://www.chevrolet.co.th/faq)
- [Volkswagen: เว็บไซต์รถยนต์ทางการ](https://www.volkswagen.com/)
- [Land Rover: เว็บไซต์รถยนต์ทางการ](https://www.landrover.com/)
- [Jaguar: เว็บไซต์รถยนต์ทางการ](https://www.jaguar.com/)
- [Lamborghini: เว็บไซต์รถยนต์ทางการ](https://www.lamborghini.com/en-en)
- [Bentley Motors: เว็บไซต์รถยนต์ทางการ](https://www.bentleymotors.com/en.html)
- [Rolls-Royce Motor Cars Bangkok: โชว์รูมทางการ](https://www.rolls-roycemotorcars.com/bangkok/en_GB/showroom.html)
- [Aston Martin: เว็บไซต์รถยนต์ทางการ](https://www.astonmartin.com/en)
- [Renault Group: เว็บไซต์บริษัททางการ](https://www.renault.com/)

## Validation receipt

Local checks completed: JSON parses; seven fixed IDs and themes; all scopes Thai; 368 answers; exactly one gem in every question; five exact-match starters per question; no ambiguous normalized aliases; all question source URLs use HTTPS.

Raw standalone validator result: ["Not enough world questions"].
Starter failures: []. Invalid source URL forms: [].

No change to the main bank was made by this child agent. No frequency API snapshot was fetched by this child agent.
