'use strict';

const { Resend } = require('resend');
const { v4: uuidv4 } = require('uuid');

function getAppBaseUrl() {
  const raw = process.env.APP_URL || process.env.PUBLIC_URL;
  if (raw && String(raw).trim()) return String(raw).replace(/\/$/, '');
  return 'https://bizponzor-production.up.railway.app';
}

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key || !String(key).trim()) return null;
  return new Resend(String(key).trim());
}

function defaultFrom() {
  return process.env.RESEND_FROM || 'Bizponzor <onboarding@resend.dev>';
}

/**
 * @param {{ to: string, subject: string, html: string }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, error?: string }>}
 */
async function sendEmail({ to, subject, html }) {
  const client = getResend();
  if (!client) {
    console.warn('[email] RESEND_API_KEY ausente; no se envía:', subject);
    return { ok: false, skipped: true };
  }
  const email = String(to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn('[email] destino inválido:', to);
    return { ok: false, error: 'invalid_to' };
  }
  try {
    const { data, error } = await client.emails.send({
      from: defaultFrom(),
      to: [email],
      subject: String(subject || '').slice(0, 998),
      html: String(html || '')
    });
    if (error) {
      console.error('[email] Resend:', error.message || error);
      return { ok: false, error: String(error.message || error) };
    }
    return { ok: true, id: data && data.id };
  } catch (e) {
    console.error('[email]', e.message || e);
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * @param {*} db
 * @param {string} userId
 * @param {string} type
 */
async function logEmailSent(db, userId, type) {
  if (!db || !userId || !type) return;
  try {
    const id = uuidv4();
    await db
      .prepare(
        `INSERT INTO email_logs (id, user_id, type, sent_at) VALUES (?, ?::uuid, ?, datetime('now'))`
      )
      .run(id, userId, String(type).slice(0, 200));
  } catch (e) {
    console.warn('[email_logs]', e.message || e);
  }
}

module.exports = {
  getAppBaseUrl,
  sendEmail,
  logEmailSent
};
