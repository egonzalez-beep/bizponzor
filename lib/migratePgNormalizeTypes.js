'use strict';

/**
 * Normaliza tipos en PostgreSQL: IDs → UUID, fechas relevantes → TIMESTAMPTZ, defaults NOW().
 * Idempotente: si users.id ya es uuid, solo intenta defaults en timestamps y valida.
 *
 * Elimina todas las FKs del esquema actual, convierte tipos, vuelve a crear las mismas FKs.
 */

const { getPool } = require('./db-postgres');

const DEFAULT_NOW_PAIRS = [
  ['users', 'created_at'],
  ['users', 'updated_at'],
  ['plans', 'created_at'],
  ['content', 'created_at'],
  ['subscriptions', 'created_at'],
  ['subscriptions', 'updated_at'],
  ['payments', 'created_at'],
  ['donations', 'created_at'],
  ['content_likes', 'created_at'],
  ['stars', 'created_at'],
  ['messages', 'created_at'],
  ['promo_codes', 'created_at'],
  ['promo_redemptions', 'created_at'],
  ['deleted_conversations', 'created_at'],
  ['notifications', 'created_at'],
  ['level_up_events', 'created_at'],
  ['email_logs', 'sent_at']
];

async function columnDataType(client, table, column) {
  const r = await client.query(
    `SELECT data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
     AND table_name = $1
     AND column_name = $2`,
    [table, column]
  );
  return r.rows[0] || null;
}

function isUuidType(row) {
  if (!row) return false;
  return String(row.udt_name || '').toLowerCase() === 'uuid';
}

function isTimestamptzType(row) {
  if (!row) return false;
  const dt = String(row.data_type || '').toLowerCase();
  const udt = String(row.udt_name || '').toLowerCase();
  return dt === 'timestamp with time zone' || udt === 'timestamptz';
}

function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function listForeignKeys(client) {
  const r = await client.query(`
    SELECT c.conname,
           n.nspname AS schema_name,
           cl.relname AS table_name,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class cl ON c.conrelid = cl.oid
    JOIN pg_namespace n ON cl.relnamespace = n.oid
    WHERE c.contype = 'f'
      AND n.nspname = current_schema()
    ORDER BY c.conname
  `);
  return r.rows;
}

async function dropAllForeignKeys(client, fks) {
  for (const fk of fks) {
    const tbl = `${qIdent(fk.schema_name)}.${qIdent(fk.table_name)}`;
    await client.query(`ALTER TABLE ${tbl} DROP CONSTRAINT IF EXISTS ${qIdent(fk.conname)}`);
  }
}

async function recreateForeignKeys(client, fks) {
  for (const fk of fks) {
    const tbl = `${qIdent(fk.schema_name)}.${qIdent(fk.table_name)}`;
    await client.query(`ALTER TABLE ${tbl} ADD CONSTRAINT ${qIdent(fk.conname)} ${fk.def}`);
  }
}

async function cleanupEmptyUuidLikeStrings(client) {
  const stmts = [
    `DELETE FROM email_logs WHERE user_id IS NOT NULL AND trim(user_id::text) = ''`,
    `DELETE FROM notifications WHERE user_id IS NOT NULL AND trim(user_id::text) = ''`,
    `UPDATE notifications SET read_at = NULL WHERE read_at IS NOT NULL AND trim(read_at::text) = ''`,
    `UPDATE messages SET read_at = NULL WHERE read_at IS NOT NULL AND trim(read_at::text) = ''`,
    `DELETE FROM messages WHERE trim(sender_id::text) = '' OR trim(receiver_id::text) = ''`,
    `DELETE FROM subscriptions WHERE trim(fan_id::text) = '' OR trim(creator_id::text) = '' OR trim(plan_id::text) = ''`,
    `DELETE FROM users WHERE trim(id::text) = ''`
  ];
  for (const sql of stmts) {
    try {
      await client.query(sql);
    } catch (e) {
      if (/does not exist|relation|column/i.test(String(e.message))) continue;
      throw e;
    }
  }
}

function usingUuid(col) {
  return `CASE WHEN ${col} IS NULL THEN NULL WHEN trim(${col}::text) = '' THEN NULL ELSE trim(${col}::text)::uuid END`;
}

function usingTimestamptzNullable(col) {
  return `CASE
    WHEN ${col} IS NULL OR trim(${col}::text) = '' THEN NULL
    ELSE ${col}::timestamptz
  END`;
}

function usingTimestamptzNotNull(col) {
  return `CASE
    WHEN ${col} IS NULL OR trim(${col}::text) = '' THEN CURRENT_TIMESTAMP
    ELSE ${col}::timestamptz
  END`;
}

async function alterColumnType(client, table, column, typeSql, usingExpr) {
  const meta = await columnDataType(client, table, column);
  if (!meta) return false;
  const udt = String(meta.udt_name || '').toLowerCase();
  const want = typeSql.trim().toLowerCase();

  if (want === 'uuid' && udt === 'uuid') return false;
  if (want === 'timestamptz' && isTimestamptzType(meta)) return false;

  await client.query(
    `ALTER TABLE ${qIdent(table)} ALTER COLUMN ${qIdent(column)} TYPE ${typeSql} USING (${usingExpr})`
  );
  return true;
}

async function setDefaultNow(client, table, column) {
  try {
    const meta = await columnDataType(client, table, column);
    if (!meta) return;
    if (!isTimestamptzType(meta)) return;
    await client.query(
      `ALTER TABLE ${qIdent(table)} ALTER COLUMN ${qIdent(column)} SET DEFAULT NOW()`
    );
  } catch (e) {
    if (/does not exist|relation|column/i.test(String(e.message))) return;
    throw e;
  }
}

async function applyDefaultNowAll(client) {
  for (const [table, col] of DEFAULT_NOW_PAIRS) {
    await setDefaultNow(client, table, col);
  }
}

async function runFullNormalization(client) {
  const fks = await listForeignKeys(client);
  await dropAllForeignKeys(client, fks);
  await cleanupEmptyUuidLikeStrings(client);

  const uuidCols = [
    ['users', 'id'],
    ['plans', 'id'],
    ['plans', 'creator_id'],
    ['content', 'id'],
    ['content', 'creator_id'],
    ['subscriptions', 'id'],
    ['subscriptions', 'fan_id'],
    ['subscriptions', 'creator_id'],
    ['subscriptions', 'plan_id'],
    ['payments', 'id'],
    ['payments', 'subscription_id'],
    ['payments', 'fan_id'],
    ['payments', 'creator_id'],
    ['donations', 'id'],
    ['donations', 'fan_id'],
    ['donations', 'creator_id'],
    ['mercado_pago_accounts', 'user_id'],
    ['content_likes', 'id'],
    ['content_likes', 'content_id'],
    ['content_likes', 'fan_id'],
    ['stars', 'id'],
    ['stars', 'user_id'],
    ['stars', 'content_id'],
    ['messages', 'id'],
    ['messages', 'sender_id'],
    ['messages', 'receiver_id'],
    ['promo_codes', 'id'],
    ['promo_codes', 'creator_id'],
    ['promo_redemptions', 'id'],
    ['promo_redemptions', 'promo_code_id'],
    ['promo_redemptions', 'fan_id'],
    ['deleted_conversations', 'id'],
    ['deleted_conversations', 'user_id'],
    ['deleted_conversations', 'other_user_id'],
    ['notifications', 'id'],
    ['notifications', 'user_id'],
    ['level_up_events', 'id'],
    ['level_up_events', 'user_id'],
    ['email_logs', 'id'],
    ['email_logs', 'user_id']
  ];

  for (const [table, col] of uuidCols) {
    try {
      await alterColumnType(client, table, col, 'uuid', usingUuid(col));
    } catch (e) {
      if (/does not exist|relation|column/i.test(String(e.message))) continue;
      throw e;
    }
  }

  const tsCols = [
    ['users', 'created_at', true],
    ['users', 'updated_at', true],
    ['plans', 'created_at', true],
    ['content', 'created_at', true],
    ['subscriptions', 'created_at', true],
    ['subscriptions', 'updated_at', true],
    ['subscriptions', 'next_billing', false],
    ['payments', 'created_at', true],
    ['donations', 'created_at', true],
    ['content_likes', 'created_at', true],
    ['stars', 'created_at', true],
    ['messages', 'created_at', true],
    ['messages', 'read_at', false],
    ['promo_codes', 'created_at', true],
    ['promo_redemptions', 'created_at', true],
    ['deleted_conversations', 'created_at', true],
    ['notifications', 'created_at', true],
    ['notifications', 'read_at', false],
    ['level_up_events', 'created_at', true],
    ['email_logs', 'sent_at', true]
  ];

  for (const [table, col, notNull] of tsCols) {
    try {
      const usingExpr = notNull ? usingTimestamptzNotNull(col) : usingTimestamptzNullable(col);
      await alterColumnType(client, table, col, 'timestamptz', usingExpr);
    } catch (e) {
      if (/does not exist|relation|column/i.test(String(e.message))) continue;
      throw e;
    }
  }

  await applyDefaultNowAll(client);
  await recreateForeignKeys(client, fks);
}

async function migratePgNormalizeTypes() {
  if (!process.env.DATABASE_URL) return;

  const pool = getPool();
  const client = await pool.connect();

  try {
    const idMeta = await columnDataType(client, 'users', 'id');
    if (!idMeta) {
      console.warn('[migration] tabla users no encontrada; se omite normalización PG');
      return;
    }

    if (isUuidType(idMeta)) {
      await applyDefaultNowAll(client);
      console.log('[migration] UUID & Timestamps normalized OK (esquema ya uuid)');
      return;
    }

    await client.query('BEGIN');
    await runFullNormalization(client);
    await client.query('COMMIT');
    console.log('[migration] UUID & Timestamps normalized OK');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('[migration] fallo al normalizar tipos:', e.message || e);
    throw e;
  } finally {
    client.release();
  }
}

async function validatePgSchemaOrExit() {
  if (!process.env.DATABASE_URL) return;

  const pool = getPool();
  const checks = [
    'SELECT 1 AS ok FROM users LIMIT 1',
    'SELECT 1 AS ok FROM subscriptions LIMIT 1',
    'SELECT 1 AS ok FROM email_logs LIMIT 1',
    'SELECT 1 AS ok FROM messages LIMIT 1',
    'SELECT 1 AS ok FROM notifications LIMIT 1'
  ];

  for (const sql of checks) {
    try {
      await pool.query(sql);
    } catch (e) {
      console.error('[migration] validación falló:', sql, '|', e.message || e);
      process.exit(1);
    }
  }
}

module.exports = {
  migratePgNormalizeTypes,
  validatePgSchemaOrExit
};
