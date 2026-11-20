import { getSql, isDatabaseConfigured } from '../db/client.js';
import { extractBearerToken, handleCreateSuggestions, handleListSuggestions, verifyAdminToken } from '../db/handlers.js';

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

  try {
    const sql = getSql();

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await handleCreateSuggestions(body, sql);
      return res.status(result.status).json(result.body);
    }

    if (req.method === 'GET') {
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
      const result = await handleListSuggestions(query, sql);
      if (result.contentType) {
        res.setHeader('Content-Type', result.contentType);
        if (result.filename) {
          res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        }
        return res.status(result.status).send(result.body);
      }
      return res.status(result.status).json(result.body);
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/suggestions]', err);
    return res.status(500).json({ ok: false, error: 'Database error while handling suggestions' });
  }
}
