import fs from 'node:fs';
import { getSql, isDatabaseConfigured } from '../db/client.js';
import { extractBearerToken, handleAdminAction, handleAdminDashboard, verifyAdminToken } from '../db/handlers.js';

let cachedMeta = null;
function loadQuestionMeta() {
  if (cachedMeta) return cachedMeta;
  try {
    const raw = fs.readFileSync(new URL('../data/question-meta.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    cachedMeta = Array.isArray(parsed) ? parsed : [];
  } catch {
    cachedMeta = [];
  }
  return cachedMeta;
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}

function readQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  return Object.fromEntries(params.entries());
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  if (!isDatabaseConfigured()) {
    return res.status(503).json({
      ok: false,
      code: 'DB_NOT_CONFIGURED',
      error: 'ยังไม่ได้เชื่อมต่อฐานข้อมูล (DATABASE_URL)',
    });
  }

  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected) {
    return res.status(503).json({
      ok: false,
      code: 'ADMIN_TOKEN_UNSET',
      error: 'ADMIN_TOKEN is not configured on this deployment',
    });
  }

  const query = readQuery(req);
  const token = extractBearerToken({ headers: req.headers, query });
  if (!verifyAdminToken(token, expected)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const sql = getSql();
    if (req.method === 'GET') {
      const result = await handleAdminDashboard(query, sql, loadQuestionMeta());
      return res.status(result.status).json(result.body);
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await handleAdminAction(body, sql);
      return res.status(result.status).json(result.body);
    }
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/admin]', err);
    return res.status(500).json({ ok: false, error: 'Database error while handling admin request' });
  }
}
