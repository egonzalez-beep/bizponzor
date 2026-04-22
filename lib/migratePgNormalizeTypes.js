'use strict';

/**
 * Normaliza tipos en PostgreSQL: IDs → UUID, fechas → TIMESTAMPTZ, defaults NOW().
 * Sin transacción global: cada ALTER / DROP / ADD es autónomo (fallo en uno no aborta el resto).
 * Idempotente: si users.id ya es uuid, solo ajusta defaults donde aplique.
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

/** Prioridad Railway: limpiar defaults que bloquean migración de tiempo en subscriptions. */
const SUBSCRIPTIONS_TS_PRIORITY = [
  {
    label: 'subscriptions.created_at DROP DEFAULT',
    sql: 'ALTER TABLE subscriptions ALTER COLUMN created_at DROP DEFAULT'
  },
  {
    label: 'subscriptions.updated_at DROP DEFAULT',
    sql: 'ALTER TABLE subscriptions ALTER COLUMN updated_at DROP DEFAULT'
  },
  {
    label: 'subscriptions.created_at TYPE timestamptz',
    sql:
      'ALTER TABLE subscriptions ALTER COLUMN created_at TYPE timestamptz USING created_at::timestamptz'
  },
  {
    label: 'subscriptions.updated_at TYPE timestamptz',
    sql:
      'ALTER TABLE subscriptions ALTER COLUMN updated_at TYPE timestamptz USING updated_at::timestamptz'
  },
  {
    label: 'subscriptions.created_at SET DEFAULT now()',
    sql: 'ALTER TABLE subscriptions ALTER COLUMN created_at SET DEFAULT now()'
  },
  {
    label: 'subscriptions.updated_at SET DEFAULT now()',
    sql: 'ALTER TABLE subscriptions ALTER COLUMN updated_at SET DEFAULT now()'
  }
];

async function columnDataType(pool, table, column) {
  const r = await pool.query(
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

async function execStep(pool, label, sql) {
  console.log(`[migration] ${label}`);
  try {
    await pool.query(sql);
  } catch (e) {
    console.warn(`[migration] ${label} — omitir/continuar:`, e.message || e);
  }
}

async function listForeignKeys(pool) {
  const r = await pool.query(`
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

async function dropAllForeignKeys(pool, fks) {
  for (const fk of fks) {
    const tbl = `${qIdent(fk.schema_name)}.${qIdent(fk.table_name)}`;
    const label = `FK DROP ${fk.table_name}.${fk.conname}`;
    await execStep(pool, label, `ALTER TABLE ${tbl} DROP CONSTRAINT IF EXISTS ${qIdent(fk.conname)}`);
  }
}

async function recreateForeignKeys(pool, fks) {
  for (const fk of fks) {
    const tbl = `${qIdent(fk.schema_name)}.${qIdent(fk.table_name)}`;
    const label = `FK ADD ${fk.table_name}.${fk.conname}`;
    await execStep(pool, label, `ALTER TABLE ${tbl} ADD CONSTRAINT ${qIdent(fk.conname)} ${fk.def}`);
  }
}

async function migrateSubscriptionsTimestampsPriority(pool) {
  for (const step of SUBSCRIPTIONS_TS_PRIORITY) {
    await execStep(pool, step.label, step.sql);
  }
}

async function cleanupEmptyUuidLikeStrings(pool) {
  const stmts = [
    ['cleanup email_logs.user_id vacío', `DELETE FROM email_logs WHERE user_id IS NOT NULL AND trim(user_id::text) = ''`],
    ['cleanup notifications.user_id vacío', `DELETE FROM notifications WHERE user_id IS NOT NULL AND trim(user_id::text) = ''`],
    ['cleanup notifications.read_at vacío', `UPDATE notifications SET read_at = NULL WHERE read_at IS NOT NULL AND trim(read_at::text) = ''`],
    ['cleanup messages.read_at vacío', `UPDATE messages SET read_at = NULL WHERE read_at IS NOT NULL AND trim(read_at::text) = ''`],
    ['cleanup messages sender/receiver vacío', `DELETE FROM messages WHERE trim(sender_id::text) = '' OR trim(receiver_id::text) = ''`],
    ['cleanup subscriptions fan/creator/plan vacío', `DELETE FROM subscriptions WHERE trim(fan_id::text) = '' OR trim(creator_id::text) = '' OR trim(plan_id::text) = ''`],
    ['cleanup users.id vacío', `DELETE FROM users WHERE trim(id::text) = ''`]
  ];
  for (const [label, sql] of stmts) {
    await execStep(pool, label, sql);
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

async function tryAlterColumnType(pool, table, column, typeSql, usingExpr) {
  const label = `${table}.${column} → ${typeSql}`;
  const meta = await columnDataType(pool, table, column);
  if (!meta) {
    console.warn(`[migration] ${label} — columna ausente, se omite`);
    return;
  }
  const udt = String(meta.udt_name || '').toLowerCase();
  const want = typeSql.trim().toLowerCase();

  if (want === 'uuid' && udt === 'uuid') {
    console.log(`[migration] ${label} — ya es uuid, se omite`);
    return;
  }
  if (want === 'timestamptz' && isTimestamptzType(meta)) {
    console.log(`[migration] ${label} — ya es timestamptz, se omite`);
    return;
  }

  const sql = `ALTER TABLE ${qIdent(table)} ALTER COLUMN ${qIdent(column)} TYPE ${typeSql} USING (${usingExpr})`;
  await execStep(pool, label, sql);
}

async function setDefaultNow(pool, table, column) {
  const label = `${table}.${column} SET DEFAULT NOW()`;
  const meta = await columnDataType(pool, table, column);
  if (!meta) {
    console.warn(`[migration] ${label} — columna ausente`);
    return;
  }
  if (!isTimestamptzType(meta)) {
    console.log(`[migration] ${label} — no es timestamptz aún, se omite`);
    return;
  }
  await execStep(
    pool,
    label,
    `ALTER TABLE ${qIdent(table)} ALTER COLUMN ${qIdent(column)} SET DEFAULT NOW()`
  );
}

async function applyDefaultNowAll(pool) {
  for (const [table, col] of DEFAULT_NOW_PAIRS) {
    await setDefaultNow(pool, table, col);
  }
}

async function runFullNormalization(pool) {
  let fks = [];
  try {
    fks = await listForeignKeys(pool);
  } catch (e) {
    console.warn('[migration] listForeignKeys — continuar sin lista FK:', e.message || e);
  }

  await dropAllForeignKeys(pool, fks);
  await cleanupEmptyUuidLikeStrings(pool);

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
    await tryAlterColumnType(pool, table, col, 'uuid', usingUuid(col));
  }

  const tsCols = [
    ['users', 'created_at', true],
    ['users', 'updated_at', true],
    ['plans', 'created_at', true],
    ['content', 'created_at', true],
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
    const usingExpr = notNull ? usingTimestamptzNotNull(col) : usingTimestamptzNullable(col);
    await tryAlterColumnType(pool, table, col, 'timestamptz', usingExpr);
  }

  await applyDefaultNowAll(pool);
  await recreateForeignKeys(pool, fks);
}

async function migratePgNormalizeTypes() {
  if (!process.env.DATABASE_URL) return;

  const pool = getPool();

  try {
    await migrateSubscriptionsTimestampsPriority(pool);

    const idMeta = await columnDataType(pool, 'users', 'id');
    if (!idMeta) {
      console.warn('[migration] tabla users no encontrada; se omite normalización PG');
      return;
    }

    if (isUuidType(idMeta)) {
      await applyDefaultNowAll(pool);
      console.log('[migration] UUID & Timestamps normalized OK (esquema ya uuid)');
      return;
    }

    await runFullNormalization(pool);
    console.log('[migration] UUID & Timestamps normalized OK');
  } catch (e) {
    console.error('[migration] fase inesperada (continúa arranque):', e.message || e);
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
