# Thai culture and travel question-source notes

Prepared 2026-11-17 for the replacement localization bank. This part owns eight questions, 462 accepted canonical answers. It does not claim to be a census of every Thai film, music group, programme, tradition, island or waterfall. It does not claim to have played 500 Krillion games; the public-prompt study is owned by the parent task.

## Design and completeness

| id | answers | scope | chosen gem |
|---|---:|---|---|
| th-thai-films | 60 | Thai released films, multiple studios, old/new/live action/animation | หมานคร |
| th-thai-bands | 61 | Thai bands, duos and artist groups; no solo artists or record-label names | เดอะ ริชแมน ทอย |
| th-thai-tv | 52 | Thai games, variety, talk, talent and reality programmes, old/new across channels; prompt explicitly excludes drama titles | เกลือวันเด้อ |
| th-festivals | 40 | Thai community traditions including Thai-Chinese and regional traditions | แห่มาลัยข้าวตอก |
| th-province-trips | 77 | complete 76 provinces + Bangkok as a familiar travel destination | อุทัยธานี |
| th-islands | 53 | curated open set, marine and river islands | เกาะเกร็ด |
| th-bts-stations | 60 | complete opened Sukhumvit + Silom BTS stations in operator route data checked this turn | สายหยุด |
| th-waterfalls | 59 | curated open set, real Thai waterfalls, no province spelling test | น้ำตกแสงจันทร์ |

Each question has five familiar starter answers, one editorial gem, and multiple score tiers. Objective membership and subjective rarity are separate. Tier reasons explicitly describe editorial judgments in a Thai context, not fabricated survey percentages or passenger counts. Open categories must be extendable after playtest; an absent legitimate answer is a bank gap, not proof that the player's knowledge is wrong.

## Primary source trail

- Films: [GDH projects](https://www.gdh559.com/project), [Sahamongkol Film](https://sahamongkolfilm.com/) and [Film Archive catalogue](https://www.fapot.or.th/main/archive). [Film Archive's หมานคร entry](https://fapot.or.th/main/archive/198) establishes the gem and also identifies นางนาก, 2499 อันธพาลครองเมือง and ฟ้าทะลายโจร. Film scope is intentionally broader than any one studio catalogue.
- Bands/groups: [Smallroom artist roster](https://www.smallroom.co.th/), [GMM primary news](https://www.gmmgrammy.com/newsroom/news-single.php?id=10055), [GeneLab](https://www.genelabrecords.com/), [Spicydisc](https://www.spicydisc.com/). Smallroom roster explicitly includes The Richman Toy, Tattoo Colour, Polycat, Dept, SLUR and others. Solo acts on those same rosters were not imported as groups; YourMOOD was removed during review.
- TV: [Workpoint programmes](https://www.workpointtv.com/programs), [One31 programme slate](https://www.one31.net/news/detail/53678), [Channel3 schedule PDF](https://assets.ch3plus.com/schedule/media/2026/03/0193685247.pdf). [One31's เกลือ วัน เด้อ page](https://www.one31.net/shows/detail/321) explicitly identifies it as variety/comedy/talk. The question does not silently restrict the answer set to ThaiPBS or one producer.
- Traditions: [TAT event catalogue](https://www.tourismthailand.org/Events-and-Festivals), [Thai intangible cultural heritage](https://ich-thailand.org/), [TAT นครพนม article](https://thai.tourismthailand.org/Articles/3-sanook-nakhon-phanom), [Yasothon Tourism and Sports: แห่มาลัยข้าวตอก](https://yasothon.mots.go.th/news/479). The gem is a local tradition, not an invented variant. Festivals imported from Thai-Chinese community practice are explicitly within reveal scope.
- Provinces: [OPDC province/group dataset](https://dataportal.opdc.go.th/th/dataset/province-name-group). Count verified as77 unique accepted labels. Bangkok is accepted for everyday phrasing and its special administrative status is explained after answering.
- Islands: [TAT natural tourism catalogue](https://tourismproduct.tourismthailand.org/wp-content/uploads/2022/10/สินค้าท่องเที่ยวทางธรรมชาติ.pdf), [TAT เกาะง่ามใหญ่/เกาะง่ามน้อย](https://www.tourismthailand.org/Attraction/ko-ngam-yai-and-ko-ngam-noi), [TAT เกาะเกร็ด](https://thai.tourismthailand.org/Articles/สัมผัสเสน่ห์เกาะเกร็ด-นนทบุรี). River islands are deliberately accepted to avoid an unstated sea-only condition. Same-name islands across provinces are one text answer, because no province is required. Generic travel shorthand such as เกาะพีพี and เกาะลันตา resolves to the conventional main island already in this curated set; it does not add a second scored entity.
- BTS: [official route map](https://www.bts.co.th/routemap.html), [operator history](https://www.bts.co.th/info/info-history.html), [official station-name fare PDF](https://btsapp1.bts.co.th/website/files/uploads/tickets/pdf/fare_Adult_2JAN24.pdf). Route HTML station-pointer attributes were extracted this turn and filtered to keys n1..n5, n7..n24, cen, e1..e23, w1, s1..s12 =60. Excluded Gold/Yellow/Pink entries that also appear in operator map HTML; N6 was absent and was not invented as open. The route HTML misspells S8 Thai as วงเวียนใหญ and English with a stray Thai tone mark; normalized canonical วงเวียนใหญ่ / Wongwian Yai is supported by operator PDF. MRT จตุจักร was not added as an alias for หมอชิต.
- Waterfalls: [TAT natural tourism catalogue](https://tourismproduct.tourismthailand.org/wp-content/uploads/2022/10/สินค้าท่องเที่ยวทางธรรมชาติ.pdf), [TAT Chaiyaphum](https://www.tourismthailand.org/Articles/10-things-to-do-in-chaiyaphum), [TAT น้ำตกแสงจันทร์ attraction](https://www.tourismthailand.org/Attraction/namtok-saeng-chan-namtok-long-ru) and [TAT discovery article](https://tourismproduct.tourismthailand.org/articles/the-feeling-of-endless-discovery-139?lang=th). The gem is explicitly described as น้ำตกแสงจันทร์ (น้ำตกลงรู) in อำเภอโขงเจียม อุบลราชธานี. Accepted short names avoid requiring province recall.

These primary catalogues anchor membership and scope; this is a curated content release, not a new statistical sample or an exhaustive row-level scholarly gazetteer. Question-level sources are stored in JSON so source presentation can remain attached to each prompt.

## Wikipedia proxies

Only13 answer entities have wikiTitle. Each was checked using the Thai MediaWiki query API with redirects plus introductory text to verify entity identity: แฟนฉัน, หมานคร, บอดี้สแลม, เดอะริชแมนทอย, แฟนพันธุ์แท้, สงกรานต์ในประเทศไทย, จังหวัดเชียงใหม่, จังหวัดอุทัยธานี, เกาะสมุย, เกาะเกร็ด, สถานีสยาม, สถานีสายหยุด, น้ำตกทีลอซู. All other values are null. Missing exact gem pages for เกลือวันเด้อ, ประเพณีแห่มาลัยข้าวตอก and น้ำตกแสงจันทร์ were not replaced with unrelated broader articles. Pageviews, if later fetched, are interest proxies only and do not validate tiers or prove percentage of people who know an answer.

## Verification performed

- JSON parses: eight questions,462 canonical answers.
- 77 unique province/destination labels and60 unique exact-scope BTS station keys.
- Exactly one krillion tier per question; all tier IDs exist in src/game.js.
- Five starter labels per question and each maps to an accepted canonical label.
- No cross-answer alias collisions under the actual normalize/answerForms functions (spaces and periods removed as game does).
- No main bank, UI, tests, or Git changed by this bounded content task.
