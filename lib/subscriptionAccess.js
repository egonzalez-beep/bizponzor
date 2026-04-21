'use strict';

/**
 * Expresión SQL: la fila de `subscriptions` aún otorga acceso al fan (periodo pagado).
 * @param {string} tableAlias - sin punto final, ej. 's'
 */
function subscriptionGrantsAccessSql(tableAlias = '') {
  const p = tableAlias ? `${tableAlias}.` : '';
  // IS NOT TRUE / IS TRUE: válido en PostgreSQL (BOOLEAN) y SQLite (0/1), evita "boolean = integer".
  return `${p}status = 'active' AND ((${p}cancel_at_period_end IS NOT TRUE) OR (${p}next_billing IS NOT NULL AND ${p}next_billing > datetime('now')))`;
}

/**
 * Marca como canceladas las suscripciones activas cuya baja ya venció (next_billing pasado).
 * @returns {Promise<number>} filas actualizadas (changes)
 */
async function expireCancelledAtPeriodEnd(db) {
  const r = await db
    .prepare(
      `UPDATE subscriptions
       SET status = 'cancelled', updated_at = datetime('now')
       WHERE status = 'active'
         AND cancel_at_period_end IS TRUE
         AND (next_billing IS NULL OR next_billing <= datetime('now'))`
    )
    .run();
  return Number(r.changes ?? 0);
}

module.exports = {
  subscriptionGrantsAccessSql,
  expireCancelledAtPeriodEnd
};
