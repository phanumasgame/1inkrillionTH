import { neon } from '@neondatabase/serverless';

let cachedUrl = null;
let cachedSql = null;

export function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

export function isDatabaseConfigured() {
  return Boolean(getDatabaseUrl());
}

export function getSql() {
  const url = getDatabaseUrl();
  if (!url) {
    const err = new Error('DATABASE_URL is not configured');
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!cachedSql || cachedUrl !== url) {
    cachedUrl = url;
    cachedSql = neon(url);
  }
  return cachedSql;
}
