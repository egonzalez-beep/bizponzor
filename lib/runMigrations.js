'use strict';

const fs = require('fs');
const path = require('path');
const { getPool } = require('./db-postgres');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations', 'pg');
const ADVISORY_LOCK_KEY = 1337;

const CREATE_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);
`;

/**
 * Ejecuta migraciones versionadas en PostgreSQL (Railway / DATABASE_URL).
 * SQLite u entornos sin DATABASE_URL: no hace nada.
 *
 * Cada archivo .sql en migrations/pg/ corre en una transacción propia con
 * pg_advisory_xact_lock para evitar carreras entre procesos.
 */
async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    console.log('[Migration] Skip: no DATABASE_URL (no PostgreSQL)');
    return;
  }

  const pool = getPool();

  await pool.query(CREATE_MIGRATIONS_TABLE_SQL);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[Migration] No hay carpeta', MIGRATIONS_DIR, '(nada que aplicar)');
    return;
  }

  const fileNames = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const fileName of fileNames) {
    const fullPath = path.join(MIGRATIONS_DIR, fileName);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);

      const dup = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [fileName]);
      if (dup.rowCount > 0) {
        await client.query('COMMIT');
        console.log('[Migration] Skip (already applied):', fileName);
        continue;
      }

      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [fileName]);
      await client.query('COMMIT');
      console.log('[Migration] Success:', fileName);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      console.error('[Migration] Fatal error:', fileName, err && (err.message || err));
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  runMigrations,
  MIGRATIONS_DIR
};
