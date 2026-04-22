'use strict';

const { sendEmail, logEmailSent, getAppBaseUrl } = require('./emailService');

/** Dedupe key en logs (mismo valor que type en email_logs) */
const MISSED_REVENUE_LOG_TYPE = 'missed_revenue_alert';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(innerHtml) {
  const base = getAppBaseUrl();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;background:#0f172a;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e2e8f0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 16px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
<tr><td style="padding:28px 24px 8px;font-size:15px;line-height:1.55;">${innerHtml}</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;color:#64748b;">Bizponzor · <a href="${esc(
    base
  )}" style="color:#38bdf8;">${esc(base)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

/** Registro creador — bienvenida + MP */
async function sendWelcomeCreatorEmail(db, user) {
  if (!user || user.role !== 'creator' || !user.email) return;
  const base = getAppBaseUrl();
  const link = `${base}/settings/payments`;
  const html = layout(`
    <p style="margin:0 0 10px;font-size:18px;font-weight:800;color:#fff;">Ya puedes ganar dinero aquí. <strong style="color:#fbbf24;">Te falta 1 paso.</strong> 🚀</p>
    <p style="margin:0 0 14px;color:#cbd5e1;">Importante: sin <strong>Mercado Pago</strong> conectado, nadie puede completarte un pago. No es opinión: es cómo funciona el checkout.</p>
    <p style="margin:0 0 14px;color:#f87171;font-weight:700;"><strong>Estás perdiendo dinero</strong> cada vez que alguien intenta pagarte y se topa con un muro.</p>
    <p style="margin:0 0 20px;color:#94a3b8;font-size:14px;">Dos minutos. Activas cobros. Vuelves al juego.</p>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Configurar Mercado Pago →</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">Si hoy alguien intenta pagarte… sin esto, <strong>no entra un peso.</strong></p>
  `);
  const r = await sendEmail({
    to: user.email,
    subject: 'Ya puedes ganar dinero aquí — te falta 1 paso',
    html
  });
  if (r.ok) await logEmailSent(db, user.id, 'welcome_creator');
}

// ⚠️ Actualmente no se usa en flujo de suscripciones.
// Se mantiene como respaldo para posibles flujos futuros o pruebas A/B.

/** Fan intentó pagar y el creador no tiene MP válido */
async function sendCheckoutMpBlockedEmail(db, creator, fanName) {
  if (!creator || !creator.email || !String(creator.email).includes('@')) return;
  const base = getAppBaseUrl();
  const link = `${base}/settings/payments`;
  const fanLine = fanName
    ? ` <strong>${esc(fanName)}</strong> estaba listo para pagar.`
    : ' Un fan estaba listo para pagar.';
  const html = layout(`
    <p style="margin:0 0 10px;font-size:18px;font-weight:800;color:#fff;">Un fan intentó suscribirse… <strong style="color:#f87171;">y no pudo pagar.</strong> ⚠️</p>
    <p style="margin:0 0 14px;">${fanLine}</p>
    <p style="margin:0 0 14px;color:#e2e8f0;">No es problema del fan. <strong>Es tu configuración.</strong></p>
    <p style="margin:0 0 16px;color:#fbbf24;font-weight:700;">Esto significa dinero que ya querían darte y no entró. 💸</p>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#22c55e;color:#0f172a;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Configurar Mercado Pago ahora</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">Ojo: mientras esto siga así, el checkout vuelve a fallar.</p>
  `);
  const r = await sendEmail({
    to: creator.email,
    subject: 'Estás perdiendo dinero ahora mismo',
    html
  });
  if (r.ok) await logEmailSent(db, creator.id, 'checkout_mp_blocked');
}

/**
 * Alerta de ingreso perdido — mismo contexto que checkout bloqueado, tono más directo.
 * Dedupe: no reenviar en menos de 12 h (type fijo en email_logs).
 */
async function sendMissedRevenueAlertEmail(db, creator, fanName) {
  if (!creator || !creator.email || !String(creator.email).includes('@')) return;

  const row = await db
    .prepare(
      `SELECT MAX(sent_at) AS last_sent FROM email_logs WHERE user_id = ? AND type = ?`
    )
    .get(creator.id, MISSED_REVENUE_LOG_TYPE);

  if (row && row.last_sent) {
    const t = new Date(row.last_sent).getTime();
    if (!Number.isNaN(t) && Date.now() - t < 12 * 60 * 60 * 1000) return;
  }

  const base = getAppBaseUrl();
  const link = `${base}/settings/payments`;
  const fanHint = fanName ? ` (${esc(fanName)} estaba en el flujo.)` : '';
  const html = layout(`
    <p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#fff;">Alguien intentó darte dinero… <strong style="color:#f87171;">pero no se pudo completar el pago.</strong></p>
    <p style="margin:0 0 14px;color:#cbd5e1;">Esto normalmente pasa cuando tu cuenta de <strong>Mercado Pago</strong> no está bien configurada en Bizponzor.${fanHint}</p>
    <p style="margin:0 0 16px;color:#fbbf24;font-weight:700;">Cada intento fallido es dinero que estás dejando pasar.</p>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#ef4444,#f97316);color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Arreglar ahora mi cuenta</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">Esto puede seguir pasando si no lo revisas.</p>
  `);
  const r = await sendEmail({
    to: creator.email,
    subject: 'Un fan intentó pagarte y no pudo',
    html
  });
  if (r.ok) await logEmailSent(db, creator.id, MISSED_REVENUE_LOG_TYPE);
}

/** 24h sin MP y sin contenido (lo dispara el job) */
async function sendActivationReminderEmail(db, user) {
  if (!user || !user.email) return;
  const base = getAppBaseUrl();
  const linkPay = `${base}/settings/payments`;
  const linkHome = `${base}/`;
  const html = layout(`
    <p style="margin:0 0 10px;font-size:18px;font-weight:800;color:#fff;">Tu cuenta está incompleta. 🚀</p>
    <p style="margin:0 0 14px;">Tienes presencia. Lo que no tienes aún es <strong>máquina de ingresos</strong>: sin contenido o sin pagos activos, no hay cobro.</p>
    <p style="margin:0 0 12px;font-weight:700;color:#fbbf24;">Importante:</p>
    <ul style="margin:0 0 18px;padding-left:20px;color:#cbd5e1;">
      <li>Sube contenido (aunque sea poco, pero hoy)</li>
      <li>Activa Mercado Pago</li>
      <li>Comparte tu perfil como si fuera un lanzamiento</li>
    </ul>
    <p style="margin:0 0 12px;"><a href="${esc(linkPay)}" style="display:inline-block;background:#22c55e;color:#0f172a;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:10px;margin-right:8px;">Activar pagos</a> <a href="${esc(linkHome)}" style="display:inline-block;background:#334155;color:#f8fafc;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:10px;">Ir al perfil</a></p>
    <p style="margin:16px 0 0;color:#64748b;font-size:13px;">Sin esas tres, <strong>no estás perdiendo suerte</strong>: estás apagando el interruptor del ingreso.</p>
  `);
  const r = await sendEmail({
    to: user.email,
    subject: 'Tu cuenta está incompleta — y ahí se frena el ingreso',
    html
  });
  if (r.ok) await logEmailSent(db, user.id, 'activation_reminder');
}

/** Suscripción activa (pago o gratis) */
async function sendNewSubscriberEmail(db, creator, fan, plan, subscriptionId) {
  if (!creator || !creator.email || !subscriptionId) return;
  const logType = `new_subscriber:${subscriptionId}`;
  const dup = await db.prepare('SELECT id FROM email_logs WHERE user_id = ? AND type = ?').get(creator.id, logType);
  if (dup) return;

  const fanName = (fan && fan.name) || 'Un fan';
  const planName = (plan && plan.name) || 'tu plan';
  const base = getAppBaseUrl();
  const link = `${base}/`;
  const html = layout(`
    <p style="margin:0 0 10px;font-size:20px;font-weight:800;color:#fff;">Ya te están pagando. 💸</p>
    <p style="margin:0 0 14px;"><strong>${esc(fanName)}</strong> entró con el plan <strong>${esc(planName)}</strong>. Eso es confianza convertida en ingreso.</p>
    <p style="margin:0 0 16px;color:#cbd5e1;">El siguiente movimiento lo pones tú: más contenido y más conversación = más renovaciones y más boca a boca.</p>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#0ea5e9);color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Subir contenido e interactuar →</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">Esto recién empieza si te quedas activo. 🚀</p>
  `);
  const r = await sendEmail({
    to: creator.email,
    subject: 'Nuevo suscriptor — esto ya es ingreso real',
    html
  });
  if (r.ok) await logEmailSent(db, creator.id, logType);
}

/** Recordatorio ingresos (job cada 3 días) */
async function sendRevenueNudgeEmail(db, user) {
  if (!user || !user.email) return;
  const base = getAppBaseUrl();
  const link = `${base}/`;
  const html = layout(`
    <p style="margin:0 0 10px;font-size:18px;font-weight:800;color:#fff;">Tienes todo listo… <strong style="color:#fbbf24;">y no estás generando.</strong></p>
    <p style="margin:0 0 14px;color:#cbd5e1;">Ojo: no suele ser “mala suerte”. Suele ser <strong>visibilidad</strong>, <strong>contenido</strong> o <strong>consistencia</strong>. Arreglas una y el tablero se mueve.</p>
    <p style="margin:0 0 12px;font-weight:700;">Hoy, sin excusas:</p>
    <ul style="margin:0 0 18px;padding-left:20px;color:#cbd5e1;">
      <li>Publica algo con gancho</li>
      <li>Responde mensajes (ahí se cierra la venta)</li>
      <li>Revisa que tu perfil se entienda en 3 segundos</li>
    </ul>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Publicar y mejorar mi perfil →</a></p>
    <p style="margin:0;color:#64748b;font-size:13px;">Pequeños golpes, repetidos, ganan. ⚠️</p>
  `);
  const r = await sendEmail({
    to: user.email,
    subject: 'Tienes la cuenta lista — falta que cobre',
    html
  });
  if (r.ok) await logEmailSent(db, user.id, 'revenue_nudge');
}

/** Tras activar suscripción (webhook, activate o gratis). Evita duplicados por subscription id. */
async function notifyNewSubscriberIfPaid(db, subscriptionId) {
  if (!subscriptionId) return;
  const sub = await db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(subscriptionId);
  if (!sub || sub.status !== 'active') return;
  const creator = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(sub.creator_id);
  const fan = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(sub.fan_id);
  const plan = await db.prepare('SELECT name FROM plans WHERE id = ?').get(sub.plan_id);
  await sendNewSubscriberEmail(db, creator, fan, plan, subscriptionId);
}

module.exports = {
  sendWelcomeCreatorEmail,
  sendCheckoutMpBlockedEmail,
  sendMissedRevenueAlertEmail,
  sendActivationReminderEmail,
  sendNewSubscriberEmail,
  sendRevenueNudgeEmail,
  notifyNewSubscriberIfPaid
};
