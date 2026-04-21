'use strict';

/**
 * Expresión SQL: la fila de `subscriptions` aún otorga acceso al fan (periodo pagado).
 * @param {string} tableAlias - sin punto final, ej. 's'
 */
function subscriptionGrantsAccessSql(tableAlias = '') {
  const p = tableAlias ? `${tableAlias}.` : '';
  return `${p}status = 'active' AND ((${p}cancel_at_period_end IS NULL OR ${p}cancel_at_period_end = 0 OR ${p}cancel_at_period_end = false) OR (${p}next_billing IS NOT NULL AND ${p}next_billing > datetime('now')))`;
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
         AND (cancel_at_period_end = 1 OR cancel_at_period_end = true)
         AND (next_billing IS NULL OR next_billing <= datetime('now'))`
    )
    .run();
  return Number(r.changes ?? 0);
}

module.exports = {
  subscriptionGrantsAccessSql,
  expireCancelledAtPeriodEnd
};
