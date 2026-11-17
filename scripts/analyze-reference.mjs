import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const CATALOG_URL = 'https://hints4today.com/krillion-unlimited-answers/';
const OUT = new URL('../docs/research/', import.meta.url);
const digest = text => createHash('sha256').update(text).digest('hex');
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_,x)=>String.fromCodePoint(parseInt(x,16)))
    .replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(Number(x)))
    .replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,s=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '})[s])
    .replace(/\s+/g,' ').trim();
}
export function classify(prompt) {
  const p=prompt.toLowerCase();
  if (/\bstate of matter\b/.test(p)) return tagged('science-body',p);
  if (/\bfamous ship\b|\btype of skincare product\b/.test(p)) return tagged('everyday-life',p);
  if (/\b(?:country|countries|capital city|a city|us state|national capital)\b/.test(p))
    return tagged('geography',p);
  const tests=[
    ['brands-tech',/\b(?:programming language|youtuber|instagram|youtube|email|apple device|fortune 500|gas station chain|theme park chain|advertising)\b/],
    ['games',/\b(?:video game|videogame|playable|pokemon|pokémon|minecraft|nintendo|mario|zelda|valorant|overwatch|league of legends|apex legends|wii|board game|casino game|card game|chess|roblox|fortnite|game console|video-game|game franchise|gaming|arcade game)\b/],
    ['screen-fiction',/\b(?:movie|film|tv|television|actor|actress|director|sitcom|anime|disney|pixar|ghibli|shrek|scooby|looney|marvel|superhero|supervillain|fictional|spongebob|star wars|harry potter|simpsons|sesame|cartoon|comic book|comic-book|character|puppet|saturday night live|talk show|avengers|superman)\b/],
    ['music',/\b(?:song|songs|singer|band|group|album|musician|musical|music|instrument|composer|rapper|beatles|grammy|orchestra|woodwind|brass|percussion|beyonc|taylor swift|nursery rhyme)\b/],
    ['sports',/\b(?:sport|sports|athlete|olympic|olympics|football|soccer|nba|nfl|mlb|nhl|cricket|fifa|world cup|premier league|tennis|baseball|basketball|rugby|boxing|martial art|formula 1|f1|wrestl|golf|gymnast|racing|ball|racquet|paddle|team|player|champion|championship|coach|club|teammate)\b/],
    ['food-drink',/\b(?:food|dish|drink|beverage|fruit|vegetable|spice|herb|nut|pasta|noodle|soup|bread|coffee|tea|cake|pastry|pizza|dessert|chocolate|sauce|cooking|cheese|pepper|mushroom|rice|salad|dumpling|sushi|snack|cuisine|flavor|flavour|bean|meat|beef|pork|chicken|seafood|cocktail|sandwich|candy|sweet|breakfast|condiment|cereal|burger|biscuit|cookie|cut of|doughnut|flour|citrus|seed|edible|topping|pudding|bakery|spaghetti|yogurt|yoghurt|apple variety|berry|curry|milk|eggs|sausage|nutrition facts)\b/],
    ['geography',/\b(?:country|countries|city|cities|capital|continent|national flag|flag|river|mountain|island|desert|ocean|sea|lake|state|territory|region|landmark|province|language of|language that|most.spoken language|spoken language|union|republic|monarch|population|coast|border|volcano|waterfall|national park|bridge|skyscraper|building|airport|europe|asia|africa|americas|landlocked|world heritage|gulf|bay)\b/],
    ['nature-animals',/\b(?:animal|bird|mammal|reptile|fish|shark|insect|creature|plant|tree|flower|weather|cloud|whale|cat|dog|rodent|primate|ape|waterfowl|parrot|penguin|beetle|owl|spider|crab|crustacean|marsupial|amphibian|lizard|mollusk|shellfish|dinosaur|fossil|snake|butterfly|turtle|habitat|geologic|gemstone|mineral|fern|conifer|natural phenomenon|natural disaster|songbird)\b/],
    ['science-body',/\b(?:chemical|element|periodic|science|unit|metric|planet|vitamin|dietary|body|bone|organ|hormone|energy|matter|medical|medicine|disease|illness|muscle|blood|cell|anatomy|mathemat|number|shape|angle|polygon|triangle|geometric|physics|astronom|solar|moon|space|star|constellation|measurement|si prefix|scientist|physicist|subatomic particle|graph|chart|human brain|atmosphere|field of math|magnify|symptom|bodily|biological process)\b/],
    ['brands-tech',/\b(?:brand|company|companies|app|software|browser|technology|internet|social media|website|platform|news organization|newspaper|car|automobile|motorcycle|vehicle|phone|smartphone|iphone|android|computer|keyboard|emoji|search engine|streaming|fast.food chain|restaurant chain|product|lego|advert|store chain|airline|retailer|social network)\b/],
    ['books-language-history',/\b(?:book|author|novel|poet|poetry|poem|writer|shakespeare|fairy tale|myth|god|goddess|religion|religious|bible|president|ruler|emperor|historic|history|war|empire|greek alphabet|letter|word|vowel|consonant|syllable|language|punctuation|typographic|zodiac|philosoph|philosopher|artist|art movement|painting|painted|sculpt|deity|fairytale|roald dahl|dr. seuss|street suffix|literary genre|christianity|islam|hinduism|judaism|buddhism)\b/],
    ['everyday-life',/\b(?:job|profession|occupation|tool|utensil|furniture|clothing|clothes|shoe|footwear|accessory|fabric|material|household|home|house|kitchen|bathroom|bedroom|toy|tape|armor|armour|weapon|knot|dance|yoga|exercise|hobby|activity|game|uniform|repair|school|major|university|college|holiday|festival|celebration|container|bag|clean|beauty|cosmetic|makeup|hair|paint|color|colour|shade|metal|person|people|transport|instrument|writing|hat|room|sport equipment|shop|shopkeeper|smell|scent|perfume|item|object|thing|profession|occupation|clue|sign|symbol|pattern|strap|button|profession)\b/]
  ];
  let category=tests.find(([,r])=>r.test(p))?.[0] || 'review';
  if(category==='review'&&/\b(?:hairstyle|currency|wood|paper|gun|transportation|military|office supply|card|finance|sun|airplane|insurance|tube|pay|brush|filter|roll|powder|steam|stick|blade|minimum age|bed|physical pages|ride|contact|halloween|sky|sprayed)\b/.test(p)) category='everyday-life';
  return tagged(category,p);
}
function tagged(category,p) {
  const spelling=/\b(?:letter|letters|one.word|one word|syllable|syllables|starts? with|ends? in|ends? with|begins? with|ending in|word that|word beginning)\b/.test(p);
  const number=/\d|\b(?:at least|more than|less than|fewer than|over a|under a|bigger than|smaller than|million|billion|two or more|three or more)\b/.test(p);
  const constrained=/\b(?:that|whose|which|with|without|where|who|only|excluding|except|between|ending|starts|ends|from|directed by|starring|above|below|under|over)\b|[()]|\d/.test(p);
  const academic=/\b(?:chemical element|metric|si prefix|state of matter|human hormone|bone|organ of|part of the human eye|greek alphabet|geologic eon|mathemat|unit|nuclear|periodic)\b/.test(p);
  return {category,tags:[spelling?'spelling-rule':null,number?'numeric-rule':null,
    !constrained?'simple-category':null,academic?'reference-knowledge':null].filter(Boolean)};
}

export function parseCatalog(html) {
  const tables=[...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(m=>m[0]);
  const table=tables.sort((a,b)=>b.length-a.length)[0];
  if(!table)throw new Error('No public prompt table found');
  return [...table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].flatMap(m=>{
    const cells=[...m[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>c[1]);
    if(cells.length!==4)return [];
    const prompt=text(cells[1]),dive=Number(text(cells[2]).replace('#',''));
    const parsed=Date.parse(text(cells[3])+' 00:00:00 UTC');
    const source=cells[3].match(/href=["']([^"']+)["']/i)?.[1];
    if(!prompt||!Number.isInteger(dive)||!Number.isFinite(parsed)||!source)throw new Error('Unexpected catalog row');
    return [{prompt,dive,date:new Date(parsed).toISOString().slice(0,10),source}];
  });
}
export async function analyze() {
  const response=await fetch(CATALOG_URL,{headers:{'User-Agent':'KrillionTH-ContentStudy/0.1 (public catalog research)'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('Public catalog HTTP '+response.status);
  const html=await response.text(),all=parseCatalog(html);
  const unique=[...new Map(all.map(row=>[row.prompt.toLowerCase().replace(/[.!?]+$/,'').trim(),row])).values()];
  if(unique.length<500)throw new Error('Only '+unique.length+' distinct prompts available; cannot claim 500');
  const selected=unique.map(row=>({...row,sampleKey:digest('krillion-th-content-study-2026-11-17:'+row.prompt)}))
    .sort((a,b)=>a.sampleKey.localeCompare(b.sampleKey)).slice(0,500).sort((a,b)=>a.dive-b.dive||a.sampleKey.localeCompare(b.sampleKey));
  const categorized=selected.map(row=>({...row,...classify(row.prompt)}));
  const categories={},tags={},months={};
  for(const row of categorized){
    categories[row.category]=(categories[row.category]||0)+1;
    for(const tag of row.tags)tags[tag]=(tags[tag]||0)+1;
    months[row.date.slice(0,7)]=(months[row.date.slice(0,7)]||0)+1;
  }
  const wordLengths=categorized.map(r=>r.prompt.split(/\s+/).length).sort((a,b)=>a-b);
  const result={
    retrievedAt:new Date().toISOString(),catalogUrl:CATALOG_URL,sourceKind:'Independent archive reporting original Krillion.io prompts',
    sourceCaveat:'Not 500 games played. Official Archive and Unlimited beyond the free preview require an unlock in this session. Do not equate independent archive attribution with independent verification of every historical item.',
    responseSha256:digest(html),catalogOccurrences:all.length,catalogUniquePrompts:unique.length,
    selectedUniquePrompts:categorized.length,selection:'Deterministic SHA-256 ordering with fixed study seed, deduplicated prompt text, first 500; not a sample sorted by answer-pool size.',
    distinctDives:new Set(categorized.map(r=>r.dive)).size,
    dateRange:[categorized[0].date,categorized.at(-1).date],categories,tags,months,
    classifier:'Version1 ordered topic rules plus explicit spelling/numeric/simple-category/reference-knowledge tags; ambiguous and overlapping items require editorial review.',
    lengthStatistics:{
      medianEnglishWords:(wordLengths[249]+wordLengths[250])/2,
      shortestEnglishWords:Math.min(...categorized.map(r=>r.prompt.split(/\s+/).length)),
      longestEnglishWords:Math.max(...categorized.map(r=>r.prompt.split(/\s+/).length))
    },
    records:categorized.map(({prompt,sampleKey,category,tags,dive,date,source})=>({
      questionSha256:digest(prompt),sampleKey,category,tags,dive,date,source
    }))
  };
  await mkdir(OUT,{recursive:true});
  await writeFile(new URL('reference-sample-500.json',OUT),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({catalogOccurrences:all.length,unique:unique.length,selected:categorized.length,dives:result.distinctDives,
    dateRange:result.dateRange,categories,tags,months,lengthStatistics:result.lengthStatistics,unclassified:categories.review||0},null,2));
  return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  analyze().catch(error=>{console.error(error);process.exitCode=1});
}
