import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const BANK_PATH = new URL('../data/questions.json', import.meta.url);
const EVIDENCE_PATH = new URL('../data/evidence.json', import.meta.url);
const API_ROOT = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article';
const USER_AGENT = process.env.WIKIMEDIA_USER_AGENT
  || 'KrillionTH/0.1 (local prototype; offline evidence refresh) Node.js/22';
const CONCURRENCY = 2;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 20_000;

/** The 12 fully completed UTC calendar months before the supplied date. */
export function getWindow(asOf = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error('--as-of must be a valid YYYY-MM-DD date.');
  }
  const date = new Date(asOf + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== asOf) {
    throw new Error('--as-of must be a valid YYYY-MM-DD date.');
  }
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const startDate = new Date(Date.UTC(year, month - 12, 1));
  const endDate = new Date(Date.UTC(year, month, 0));
  const expectedMonths = Array.from({ length: 12 }, (_, index) =>
    new Date(Date.UTC(year, month - 12 + index, 1)).toISOString().slice(0, 7));
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  return {
    start, end, months: 12, expectedMonths,
    startTimestamp: start.replaceAll('-', '') + '00',
    endTimestamp: end.replaceAll('-', '') + '00',
  };
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Retry-After can be a number of seconds or an HTTP date. */
export function retryDelay(header, fallback, now = Date.now()) {
  if (header == null || header.trim() === '') return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const timestamp = Date.parse(header);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : fallback;
}

export function articleUrl(title, window) {
  return API_ROOT + '/th.wikipedia.org/all-access/user/' + encodeURIComponent(title)
    + '/monthly/' + window.startTimestamp + '/' + window.endTimestamp;
}

/** Incomplete data remains explicitly missing; a failed request never becomes zero views. */
export function parseArticle(payload, title, url, window) {
  const result = { status: 'missing', url, pageTitle: title, months: [],
    totalViews: null, medianMonthlyViews: null };
  if (!Array.isArray(payload?.items) || payload.items.length === 0) {
    return { ...result, error: 'No monthly records returned for this article and window.' };
  }
  const seen = new Set();
  const expected = new Set(window.expectedMonths);
  let invalid = '';
  for (const item of payload.items) {
    const timestamp = String(item.timestamp ?? '');
    if (!/^\d{10}$/.test(timestamp) || !Number.isSafeInteger(item.views) || item.views < 0) {
      invalid = 'Response contains an invalid timestamp or view count.';
      continue;
    }
    const month = timestamp.slice(0, 4) + '-' + timestamp.slice(4, 6);
    if (!expected.has(month) || seen.has(month)) {
      invalid = 'Response contains an unexpected or duplicate month.';
      continue;
    }
    if (item.project !== 'th.wikipedia' && item.project !== 'th.wikipedia.org') {
      invalid = 'Response project does not match Thai Wikipedia.';
      continue;
    }
    if (item.agent !== 'user' || item.access !== 'all-access' || item.granularity !== 'monthly') {
      invalid = 'Response traffic classification does not match the requested metric.';
      continue;
    }
    seen.add(month);
    result.months.push({ month, views: item.views });
    if (item.article) result.pageTitle = String(item.article).replaceAll('_', ' ');
  }
  result.months.sort((a, b) => a.month.localeCompare(b.month));
  if (invalid) return { ...result, status: 'error', error: invalid };
  if (result.months.length !== 12) {
    return { ...result, error: 'Only ' + result.months.length + ' of 12 required months returned.' };
  }
  return { ...result, status: 'ok',
    totalViews: result.months.reduce((total, item) => total + item.views, 0),
    medianMonthlyViews: median(result.months.map(item => item.views)) };
}

export async function collectArticle(title, window, throttle = { until: 0 }) {
  const url = articleUrl(title, window);
  const failed = (status, error) => ({ status, url, pageTitle: title, months: [],
    totalViews: null, medianMonthlyViews: null, error });
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    while (throttle.until > Date.now()) {
      await sleep(throttle.until - Date.now());
    }
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 404) {
        await response.body?.cancel();
        return failed('missing', 'HTTP 404: no article-view records available.');
      }
      if (response.status === 429 || response.status >= 500) {
        const delay = retryDelay(response.headers.get('retry-after'), 1000 * 2 ** attempt);
        await response.body?.cancel();
        if (attempt === MAX_RETRIES) return failed('error', 'HTTP ' + response.status + ': retry limit reached.');
        // A rate-limit response pauses both workers, not only the current article.
        throttle.until = Math.max(throttle.until, Date.now() + delay);
        console.log('Retry ' + title + ' after HTTP ' + response.status + ' in ' + delay + 'ms.');
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return failed('error', 'HTTP ' + response.status + ': request failed.');
      }
      return parseArticle(await response.json(), title, url, window);
    } catch (error) {
      if (attempt === MAX_RETRIES) return failed('error', error.name + ': ' + error.message);
      await sleep(1000 * 2 ** attempt);
    }
  }
  return failed('error', 'Request did not complete.');
}

export function reusableArticle(article, title, window) {
  if (article?.status !== 'ok' || article.url !== articleUrl(title, window) ||
    !Array.isArray(article.months) || article.months.length !== 12) return false;
  const months = article.months;
  if (months.some((item, index) => item.month !== window.expectedMonths[index] ||
    !Number.isSafeInteger(item.views) || item.views < 0)) return false;
  return article.totalViews === months.reduce((total, item) => total + item.views, 0) &&
    article.medianMonthlyViews === median(months.map(item => item.views));
}

export async function refreshEvidence(asOf, { reuseComplete = false } = {}) {
  const window = getWindow(asOf);
  const bank = JSON.parse(await readFile(BANK_PATH, 'utf8'));
  const titles = [...new Set(bank.questions.flatMap(question =>
    question.answers.map(answer => answer.wikiTitle)).filter(Boolean))].sort();
  const articles = {};
  let cached = {};
  let previousSnapshotGeneratedAt = null;
  if (reuseComplete) {
    try {
      const previous=JSON.parse(await readFile(EVIDENCE_PATH, 'utf8'));
      cached=previous.articles || {};
      previousSnapshotGeneratedAt=previous.generatedAt || null;
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const throttle = { until: 0 };
  let cursor = 0;
  let completed = 0;
  let reusedCompleteArticles = 0;
  console.log('Refreshing ' + titles.length + ' articles for ' + window.start + ' to ' + window.end + '.');
  async function worker() {
    while (cursor < titles.length) {
      const title = titles[cursor++];
      const reused = reuseComplete && reusableArticle(cached[title], title, window);
      if (reused) reusedCompleteArticles++;
      const article = reused ? cached[title] : {
        ...await collectArticle(title, window, throttle), retrievedAt: new Date().toISOString()
      };
      articles[title] = article;
      completed++;
      if (completed % 10 === 0 || completed === titles.length || article.status !== 'ok') {
        console.log(completed + '/' + titles.length + ': ' + title + ' [' + article.status + (reused ? ', reused' : '') + ']');
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, titles.length) }, worker));
  const evidence = {
    version: 1,
    bankVersion: bank.version,
    methodVersion: 'wiki-th-monthly-v1',
    generatedAt: new Date().toISOString(),
    refresh: { reusedCompleteArticles, previousSnapshotGeneratedAt },
    window: { start: window.start, end: window.end, months: 12 },
    source: 'Wikimedia Analytics API',
    articles: Object.fromEntries(titles.map(title => [title, articles[title]])),
  };
  const temporaryPath = fileURLToPath(EVIDENCE_PATH) + '.tmp-' + process.pid;
  await writeFile(temporaryPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  await rename(temporaryPath, EVIDENCE_PATH);
  const counts = Object.values(articles).reduce((total, article) => {
    total[article.status]++;
    return total;
  }, { ok: 0, missing: 0, error: 0 });
  console.log('Saved data/evidence.json: ' + JSON.stringify(counts) + '. Approved answer tiers were not changed.');
  return { evidence, counts };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const asOf = args.find(argument => argument.startsWith('--as-of='))?.slice('--as-of='.length);
  if (args.some(argument => !argument.startsWith('--as-of=') && argument !== '--reuse-complete') ||
    args.filter(argument => argument.startsWith('--as-of=')).length > 1 ||
    args.filter(argument => argument === '--reuse-complete').length > 1) {
    console.error('Usage: node scripts/refresh-evidence.mjs [--as-of=YYYY-MM-DD] [--reuse-complete]');
    process.exitCode = 1;
  } else {
    refreshEvidence(asOf, { reuseComplete: args.includes('--reuse-complete') }).then(({ counts }) => {
      if (counts.error) process.exitCode = 1;
    }).catch(error => {
      console.error('Evidence refresh failed: ' + error.message);
      process.exitCode = 1;
    });
  }
}
