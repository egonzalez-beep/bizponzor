'use strict';

/**
 * Convierte columnas de fecha de `subscriptions` a TIMESTAMPTZ en PostgreSQL.
 * Solo ejecuta ALTER si el tipo actual no es ya timestamptz (evita errores de default/cast).
 */

async function getSubscriptionsColumnType(pool, columnName) {
  const r = await pool.query(
    `SELECT data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'subscriptions'
       AND column_name = $1`,
    [columnName]
  );
  return r.rows[0] || null;
}

function isTimestamptzColumn(row) {
  if (!row) return false;
  const dt = String(row.data_type || '').toLowerCase();
  const udt = String(row.udt_name || '').toLowerCase();
  return dt === 'timestamp with time zone' || udt === 'timestamptz';
}

async function migrateSubscriptionsTimestamptzPg() {
  if (!process.env.DATABASE_URL) return;
  const { getPool } = require('./db-postgres');
  const pool = getPool();

  const columns = [
    {
      name: 'next_billing',
      using: (col) =>
        `CASE
           WHEN ${col} IS NULL OR length(trim(${col}::text)) = 0 THEN NULL
           ELSE ${col}::timestamptz
         END`
    },
    {
      name: 'created_at',
      using: (col) =>
        `CASE
           WHEN ${col} IS NULL OR length(trim(${col}::text)) = 0 THEN CURRENT_TIMESTAMP
           ELSE ${col}::timestamptz
         END`
    },
    {
      name: 'updated_at',
      using: (col) =>
        `CASE
           WHEN ${col} IS NULL OR length(trim(${col}::text)) = 0 THEN CURRENT_TIMESTAMP
           ELSE ${col}::timestamptz
         END`
    }
  ];

  const migrated = [];

  for (const { name, using } of columns) {
    try {
      const meta = await getSubscriptionsColumnType(pool, name);
      if (!meta) continue;
      if (isTimestamptzColumn(meta)) continue;

      const sql = `ALTER TABLE subscriptions
        ALTER COLUMN ${name} TYPE timestamptz
        USING (${using(name)})`;
      await pool.query(sql);
      migrated.push(name);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/does not exist|relation.*subscriptions/i.test(msg)) {
        console.warn('[migrate] subscriptions timestamptz:', msg);
        return;
      }
      console.warn('[migrate] subscriptions timestamptz', name + ':', msg);
    }
  }

  if (migrated.length === 0) {
    console.log('[migrate] subscriptions timestamps OK (skipped)');
  } else {
    console.log('[migrate] subscriptions timestamps OK (migrated: ' + migrated.join(', ') + ')');
  }
}

module.exports = { migrateSubscriptionsTimestamptzPg };
