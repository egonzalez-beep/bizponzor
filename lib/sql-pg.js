'use strict';

/**
 * SQLite → PostgreSQL: dialect tweaks, luego ? → $1, $2, …
 * Tipos UUID / timestamptz: normalizar en la base (migratePgNormalizeTypes), no aquí.
 * @param {string} sql
 */
function adaptSqlForPostgres(sql) {
  let s = sql;

  s = s.replace(/ON CONFLICT\s*\(/gi, 'ON CONFLICT (');

  s = s.replace(/datetime\('now',\s*'-90\s*days'\)/gi, "(CURRENT_TIMESTAMP - interval '90 days')");
  s = s.replace(/datetime\('now',\s*'-30\s*days'\)/gi, "(CURRENT_TIMESTAMP - interval '30 days')");

  s = s.replace(/datetime\(m\.created_at\)/gi, 'm.created_at::timestamptz');
  s = s.replace(/datetime\(last_message_at\)/gi, 'last_message_at::timestamptz');
  s = s.replace(/datetime\(created_at\)/gi, 'created_at::timestamptz');

  s = s.replace(/datetime\(\?\)/g, 'CAST(? AS TIMESTAMPTZ)');

  s = s.replace(/datetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  s = s.replace(/datetime\("now"\)/gi, 'CURRENT_TIMESTAMP');

  s = s.replace(/DATE\(scheduled_for\)/gi, '(scheduled_for::timestamptz)::date');

  s = s.replace(
    /INSERT OR IGNORE INTO deleted_conversations \(id, user_id, other_user_id\)\s+VALUES \(\?, \?, \?\)/gi,
    'INSERT INTO deleted_conversations (id, user_id, other_user_id) VALUES (?, ?, ?) ON CONFLICT (user_id, other_user_id) DO NOTHING'
  );

  let n = 0;
  s = s.replace(/\?/g, () => `$${++n}`);

  return s;
}

module.exports = { adaptSqlForPostgres };
