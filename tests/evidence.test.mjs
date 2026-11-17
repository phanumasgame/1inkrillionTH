import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getWindow, median, retryDelay, articleUrl, parseArticle, reusableArticle } from '../scripts/refresh-evidence.mjs';

const window = getWindow('2026-11-17');
const payload = () => ({items:window.expectedMonths.map((month,i)=>({
  project:'th.wikipedia',article:'จังหวัดเชียงใหม่',granularity:'monthly',access:'all-access',agent:'user',
  timestamp:month.replace('-','')+'0100',views:i+1
}))});
test('window includes exactly 12 complete months, crosses year boundaries and handles leap year',()=>{
  assert.equal(window.start,'2025-11-01');assert.equal(window.end,'2026-10-31');
  assert.equal(window.expectedMonths.length,12);assert.equal(window.expectedMonths[11],'2026-10');
  assert.equal(getWindow('2024-03-15').end,'2024-02-29');
  assert.equal(getWindow('2026-01-01').start,'2025-01-01');
  assert.throws(()=>getWindow('2026-02-30'));
});
test('median of 12 uses both central values and does not mutate source',()=>{
  const values=[12,3,10,2,11,4,8,5,6,7,9,1],copy=[...values];
  assert.equal(median(values),6.5);assert.deepEqual(values,copy);
});
test('Retry-After supports seconds, dates and fallback',()=>{
  assert.equal(retryDelay('17',1000,0),17000);
  assert.equal(retryDelay('Thu, 01 Jan 1970 00:01:00 GMT',1000,0),60000);
  assert.equal(retryDelay('unreadable',1000,0),1000);
});
test('API URLs bind Thai Wikipedia, human traffic and the requested full-month window',()=>{
  const url=articleUrl('จังหวัดเชียงใหม่',window);
  assert.ok(url.includes('/th.wikipedia.org/all-access/user/'));
  assert.ok(url.endsWith('/monthly/2025110100/2026103100'));
  assert.ok(url.includes(encodeURIComponent('จังหวัดเชียงใหม่')));
});
test('valid complete evidence computes total and median without fabricating counts',()=>{
  const result=parseArticle(payload(),'จังหวัดเชียงใหม่','https://example.com',window);
  assert.equal(result.status,'ok');assert.equal(result.totalViews,78);assert.equal(result.medianMonthlyViews,6.5);
});

test('evidence reuse requires the same title, traffic window, complete months and recomputed totals',()=>{
  const title='จังหวัดเชียงใหม่',url=articleUrl(title,window);
  const record=parseArticle(payload(),title,url,window);
  assert.ok(reusableArticle(record,title,window));
  assert.equal(reusableArticle(record,'เชียงใหม่',window),false);
  assert.equal(reusableArticle(record,title,getWindow('2026-12-01')),false);
  assert.equal(reusableArticle({...record,status:'missing'},title,window),false);
  assert.equal(reusableArticle({...record,totalViews:0},title,window),false);
  assert.equal(reusableArticle({...record,months:record.months.slice(1)},title,window),false);
});
test('missing, duplicate, negative or mismatched traffic cannot become a complete evidence record',()=>{
  const missing=payload();missing.items.pop();
  assert.equal(parseArticle(missing,'test','https://example.com',window).status,'missing');
  assert.equal(parseArticle({},'test','https://example.com',window).totalViews,null);
  for(const mutate of [
    p=>p.items.push(p.items[0]),p=>p.items[0].views=-1,
    p=>p.items[0].agent='spider',p=>p.items[0].project='en.wikipedia',
    p=>p.items[0].access='desktop',p=>p.items[0].granularity='daily'
  ]){const p=payload();mutate(p);assert.notEqual(parseArticle(p,'test','https://example.com',window).status,'ok');}
});
test('shipped snapshot matches the bank and contains only validated real monthly series',async()=>{
  const evidence=JSON.parse(await readFile(new URL('../data/evidence.json',import.meta.url),'utf8'));
  const bank=JSON.parse(await readFile(new URL('../data/questions.json',import.meta.url),'utf8'));
  assert.equal(evidence.bankVersion,bank.version);
  const titles=new Set(bank.questions.flatMap(q=>q.answers.map(a=>a.wikiTitle)).filter(Boolean));
  assert.equal(Object.keys(evidence.articles).length,titles.size);
  const end=evidence.window.end;
  const asOf=new Date(Date.UTC(Number(end.slice(0,4)),Number(end.slice(5,7)),1)).toISOString().slice(0,10);
  const period=getWindow(asOf);
  assert.equal(period.start,evidence.window.start);
  assert.equal(period.end,end);
  for(const title of titles){
    const record=evidence.articles[title];assert.ok(record,title);
    assert.ok(['ok','missing','error'].includes(record.status),title);
    if(record.status==='ok') {
      assert.ok(reusableArticle(record,title,period),title);
    } else {
      assert.equal(record.totalViews,null,title);
      assert.equal(record.medianMonthlyViews,null,title);
      assert.ok(record.error,title);
    }
    assert.ok(record.url.startsWith('https://wikimedia.org/'),title);
  }
});
