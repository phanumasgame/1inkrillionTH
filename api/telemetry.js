import { getSql, isDatabaseConfigured } from '../db/client.js';
import { handleRecordTelemetry } from '../db/handlers.js';

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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!isDatabaseConfigured()) {
    return res.status(503).json({ ok: false, code: 'DB_NOT_CONFIGURED' });
  }

  try {
    const body = await readJsonBody(req);
    const result = await handleRecordTelemetry(body, getSql());
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[/api/telemetry]', err);
    return res.status(500).json({ ok: false, error: 'Database error while recording telemetry' });
  }
}
