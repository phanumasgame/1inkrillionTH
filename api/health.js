import { getSql, isDatabaseConfigured } from '../db/client.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const dbConfigured = isDatabaseConfigured();
  const params = new URL(req.url || '/', 'http://localhost').searchParams;
  const checkDb = params.get('check') === 'db';
  let dbConnected = null;

  if (checkDb && dbConfigured) {
    try {
      const sql = getSql();
      const rows = await sql.query('SELECT 1 AS ok');
      dbConnected = Boolean(rows?.[0]?.ok === 1);
    } catch {
      dbConnected = false;
    }
  }

  return res.status(200).json({
    ok: true,
    version: '1.0.8',
    dbConfigured,
    adminConfigured: Boolean(process.env.ADMIN_TOKEN),
    ...(dbConnected !== null ? { dbConnected } : {}),
  });
}
