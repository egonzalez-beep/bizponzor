'use strict';

/**
 * Jobs de correo para creadores (activación 24h, recordatorio ingresos cada 3 días).
 * Requiere RESEND_API_KEY; si no hay, sale sin ruido.
 */

const { sendActivationReminderEmail, sendRevenueNudgeEmail } = require('./creatorEmails');

const usePg = !!process.env.DATABASE_URL;
/** En PG, correlacionar FK uuid con u.id evita "uuid = text" si users.id llega como text en el planificador. */
const UID_CORR = usePg ? '::uuid' : '';

const SQL_ACTIVATION_REMINDERS = `SELECT u.id, u.email, u.name
       FROM users u
       WHERE u.role = 'creator'
         AND u.created_at <= ?
         AND u.created_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM mercado_pago_accounts m
           WHERE m.user_id = u.id${UID_CORR}
             AND m.mp_user_id IS NOT NULL
             AND length(trim(COALESCE(m.mp_user_id, ''))) > 0
         )
         AND NOT EXISTS (
           SELECT 1 FROM content c
           WHERE c.creator_id = u.id${UID_CORR}
             AND (c.status IS NULL OR c.status = 'published')
         )
         AND NOT EXISTS (
           SELECT 1 FROM email_logs e
           WHERE e.user_id = u.id${UID_CORR} AND e.type = 'activation_reminder'
         )`;

const SQL_REVENUE_NUDGES = `SELECT u.id, u.email, u.name
       FROM users u
       WHERE u.role = 'creator'
         AND EXISTS (
           SELECT 1 FROM mercado_pago_accounts m
           WHERE m.user_id = u.id${UID_CORR}
             AND m.mp_user_id IS NOT NULL
             AND length(trim(COALESCE(m.mp_user_id, ''))) > 0
         )
         AND EXISTS (
           SELECT 1 FROM content c
           WHERE c.creator_id = u.id${UID_CORR}
             AND (c.status IS NULL OR c.status = 'published')
         )
         AND COALESCE(
           (SELECT SUM(p.amount) FROM payments p WHERE p.creator_id = u.id${UID_CORR} AND p.status = 'completed'),
           0
         ) = 0
         AND (
           (SELECT MAX(e.sent_at) FROM email_logs e WHERE e.user_id = u.id${UID_CORR} AND e.type = 'revenue_nudge') IS NULL
           OR (SELECT MAX(e.sent_at) FROM email_logs e WHERE e.user_id = u.id${UID_CORR} AND e.type = 'revenue_nudge') < ?
         )`;

async function runActivationReminders(db) {
  if (!process.env.RESEND_API_KEY) return;
  const now = Date.now();
  const t24 = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const t36 = new Date(now - 36 * 60 * 60 * 1000).toISOString();

  if (process.env.DEBUG_EMAIL_JOB_SQL === '1') {
    console.log('[email job SQL] activation', SQL_ACTIVATION_REMINDERS);
  }

  const rows = await db.prepare(SQL_ACTIVATION_REMINDERS).all(t24, t36);

  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    if (!u.email) continue;
    try {
      await sendActivationReminderEmail(db, u);
    } catch (e) {
      console.warn('[email job] activation_reminder', u.id, e.message || e);
    }
  }
}

async function runRevenueNudges(db) {
  if (!process.env.RESEND_API_KEY) return;
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  if (process.env.DEBUG_EMAIL_JOB_SQL === '1') {
    console.log('[email job SQL] revenue_nudge', SQL_REVENUE_NUDGES);
  }

  const rows = await db.prepare(SQL_REVENUE_NUDGES).all(threeDaysAgo);

  for (let i = 0; i < rows.length; i++) {
    const u = rows[i];
    if (!u.email) continue;
    try {
      await sendRevenueNudgeEmail(db, u);
    } catch (e) {
      console.warn('[email job] revenue_nudge', u.id, e.message || e);
    }
  }
}

async function runCreatorEmailJobs(db) {
  await runActivationReminders(db);
  await runRevenueNudges(db);
}

module.exports = {
  runCreatorEmailJobs,
  runActivationReminders,
  runRevenueNudges
};
