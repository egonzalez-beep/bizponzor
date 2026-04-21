'use strict';

/**
 * Convierte columnas de fecha de `subscriptions` a TIMESTAMPTZ en PostgreSQL.
 * Idempotente si ya son timestamptz (USING cast sigue siendo válido).
 */
async function migrateSubscriptionsTimestamptzPg() {
  if (!process.env.DATABASE_URL) return;
  const { getPool } = require('./db-postgres');
  const pool = getPool();

  const usingTs = (col) =>
    `CASE
       WHEN ${col} IS NULL OR length(trim(${col}::text)) = 0 THEN NULL
       ELSE ${col}::timestamptz
     END`;

  const usingTsNonNull = (col) =>
    `CASE
       WHEN ${col} IS NULL OR length(trim(${col}::text)) = 0 THEN CURRENT_TIMESTAMP
       ELSE ${col}::timestamptz
     END`;

  const statements = [
    `ALTER TABLE subscriptions
       ALTER COLUMN next_billing TYPE timestamptz
       USING (${usingTs('next_billing')})`,
    `ALTER TABLE subscriptions
       ALTER COLUMN created_at TYPE timestamptz
       USING (${usingTsNonNull('created_at')})`,
    `ALTER TABLE subscriptions
       ALTER COLUMN updated_at TYPE timestamptz
       USING (${usingTsNonNull('updated_at')})`
  ];

  for (let i = 0; i < statements.length; i++) {
    try {
      await pool.query(statements[i]);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/does not exist|relation.*subscriptions/i.test(msg)) {
        console.warn('[migrate] subscriptions timestamptz:', msg);
        return;
      }
      console.warn('[migrate] subscriptions timestamptz paso', i + 1, ':', msg);
    }
  }
}

module.exports = { migrateSubscriptionsTimestamptzPg };
