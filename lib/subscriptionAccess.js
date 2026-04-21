'use strict';

const usePg = !!process.env.DATABASE_URL;

/** Literal “ahora” compatible con PG (timestamptz) y SQLite (TEXT ISO). */
function subscriptionNowSql() {
  return usePg ? 'NOW()' : "datetime('now')";
}

/**
 * Expresión SQL: la fila de `subscriptions` aún otorga acceso al fan (periodo pagado).
 * @param {string} tableAlias - sin punto final, ej. 's'
 */
function subscriptionGrantsAccessSql(tableAlias = '') {
  const p = tableAlias ? `${tableAlias}.` : '';
  const now = subscriptionNowSql();
  // IS NOT TRUE / IS TRUE: válido en PostgreSQL (BOOLEAN) y SQLite (0/1), evita "boolean = integer".
  return `${p}status = 'active' AND ((${p}cancel_at_period_end IS NOT TRUE) OR (${p}next_billing IS NOT NULL AND ${p}next_billing > ${now}))`;
}

/**
 * Marca como canceladas las suscripciones activas cuya baja ya venció (next_billing pasado).
 * @returns {Promise<number>} filas actualizadas (changes)
 */
async function expireCancelledAtPeriodEnd(db) {
  const now = subscriptionNowSql();
  const r = await db
    .prepare(
      `UPDATE subscriptions
       SET status = 'cancelled', updated_at = ${now}
       WHERE status = 'active'
         AND cancel_at_period_end IS TRUE
         AND (next_billing IS NULL OR next_billing <= ${now})`
    )
    .run();
  return Number(r.changes ?? 0);
}

module.exports = {
  subscriptionGrantsAccessSql,
  expireCancelledAtPeriodEnd
};
