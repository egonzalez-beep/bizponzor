'use strict';

/**
 * Tras ? → $n: fuerza cast de parámetros a uuid donde la columna es UUID en PostgreSQL.
 * No toca comparaciones columna-a-columna (ej. e.user_id = u.id).
 * SQLite tolera `::uuid` en el parámetro numerado.
 */
function applyUuidParamCasts(sql) {
  let s = sql;

  const uuidCols = [
    'user_id',
    'creator_id',
    'fan_id',
    'plan_id',
    'sender_id',
    'receiver_id',
    'other_user_id',
    'content_id',
    'promo_code_id'
  ];

  for (let i = 0; i < uuidCols.length; i++) {
    const esc = uuidCols[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `\\b((?:[\\w]+\\.)?)(${esc})\\s*(=|!=|<>)\\s*\\$(\\d+)(?!::uuid)\\b`,
      'gi'
    );
    s = s.replace(re, (full, pref, colName, op, num) => `${pref}${colName}${op}$${num}::uuid`);
  }

  s = s.replace(
    /\b((?:[\w]+\.)?)(id)\s*(=|!=|<>)\s*\$(\d+)(?!::uuid)\b/gi,
    (full, pref, idWord, op, num) => `${pref}${idWord}${op}$${num}::uuid`
  );

  return s;
}

function castFirstNPlaceholders(valuesInner, startNum, nUuid) {
  let out = valuesInner;
  for (let k = 0; k < nUuid; k++) {
    const idx = startNum + k;
    const re = new RegExp(`\\$${idx}(?!::uuid)\\b`, 'g');
    out = out.replace(re, `$${idx}::uuid`);
  }
  return out;
}

/**
 * INSERT conocidos: cast a los primeros $n que son UUID según el orden de columnas en el repo.
 */
function applyInsertUuidParamCasts(sql) {
  let s = sql;

  const patterns = [
    [
      /(INSERT INTO stars\s*\(\s*id\s*,\s*user_id\s*,\s*content_id\s*\)\s*VALUES\s*\()([^)]+)(\))/gi,
      1,
      3
    ],
    [
      /(INSERT INTO mercado_pago_accounts\s*\(\s*user_id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      1
    ],
    [
      /(INSERT INTO messages\s*\(\s*id\s*,\s*sender_id\s*,\s*receiver_id\s*,\s*content\s*\)\s*VALUES\s*\()([^)]+)(\))/gi,
      1,
      3
    ],
    [
      /(INSERT INTO donations\s*\(\s*id\s*,\s*fan_id\s*,\s*creator_id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      3
    ],
    [
      /(INSERT INTO plans\s*\(\s*id\s*,\s*creator_id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      2
    ],
    [
      /(INSERT INTO promo_codes\s*\(\s*id\s*,\s*creator_id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      2
    ],
    [
      /(INSERT INTO promo_redemptions\s*\(\s*id\s*,\s*promo_code_id\s*,\s*fan_id\s*\)\s*VALUES\s*\()([^)]+)(\))/gi,
      1,
      3
    ],
    [
      /(INSERT INTO deleted_conversations\s*\(\s*id\s*,\s*user_id\s*,\s*other_user_id\s*\)\s*VALUES\s*\()([^)]+)(\))/gi,
      1,
      3
    ],
    [
      /(INSERT INTO notifications\s*\(\s*id\s*,\s*user_id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      2
    ],
    [
      /(INSERT INTO level_up_events\s*\(\s*id\s*,\s*user_id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      2
    ],
    [
      /(INSERT INTO users\s*\(\s*id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      1
    ],
    [
      /(INSERT INTO content\s*\(\s*id\s*,\s*creator_id\s*,[\s\S]*?VALUES\s*\()([^)]+)(\))/gi,
      1,
      2
    ]
  ];

  for (let p = 0; p < patterns.length; p++) {
    const [re, startNum, count] = patterns[p];
    s = s.replace(re, (full, head, valuesPart, tail) => {
      const m = valuesPart.match(/\$(\d+)/g);
      const start = m && m.length ? Math.min(...m.map((x) => parseInt(x.slice(1), 10))) : startNum;
      const inner = castFirstNPlaceholders(valuesPart, start, count);
      return head + inner + tail;
    });
  }

  return s;
}

/** Primeros cuatro placeholders de cualquier INSERT INTO subscriptions (id, fan_id, creator_id, plan_id, …). */
function castSubscriptionInsertFirstFour(sql) {
  return sql.replace(
    /(INSERT INTO subscriptions[\s\S]*?\bVALUES\s*\(\s*)(\$\d+)(?!::uuid)(\s*,\s*)(\$\d+)(?!::uuid)(\s*,\s*)(\$\d+)(?!::uuid)(\s*,\s*)(\$\d+)(?!::uuid)(\s*,)/gi,
    (full, head, a, sp1, b, sp2, c, sp3, d, sp4) =>
      `${head}${a}::uuid${sp1}${b}::uuid${sp2}${c}::uuid${sp3}${d}::uuid${sp4}`
  );
}

/**
 * SQLite → PostgreSQL: dialect tweaks, then ? → $1, $2, …
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

  s = applyUuidParamCasts(s);
  s = applyInsertUuidParamCasts(s);
  s = castSubscriptionInsertFirstFour(s);

  return s;
}

module.exports = { adaptSqlForPostgres };
