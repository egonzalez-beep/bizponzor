'use strict';

const { sendEmail, logEmailSent, getAppBaseUrl } = require('./emailService');

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
  const link = `${base}/?tab=settings`;
  const html = layout(`
    <p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#fff;">Tu cuenta ya está lista. Pero ahora mismo <strong style="color:#f87171;">NO puedes recibir dinero.</strong></p>
    <p style="margin:0 0 16px;">Eso no es drama: es configuración. Si no conectas <strong>Mercado Pago</strong>, nadie puede completarte un cobro aunque quiera.</p>
    <p style="margin:0 0 20px;"><strong>Conecta tu cuenta en menos de 2 minutos aquí:</strong></p>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Ir a conectar Mercado Pago</a></p>
    <p style="margin:0;color:#94a3b8;font-size:14px;">Si hoy alguien intenta pagarte… el dinero <strong>no</strong> llegará. Arreglémoslo hoy.</p>
  `);
  const r = await sendEmail({
    to: user.email,
    subject: 'Ya puedes empezar a ganar dinero (pero hay un detalle)',
    html
  });
  if (r.ok) await logEmailSent(db, user.id, 'welcome_creator');
}

/** Fan intentó pagar y el creador no tiene MP válido */
async function sendCheckoutMpBlockedEmail(db, creator, fanName) {
  if (!creator || !creator.email || !String(creator.email).includes('@')) return;
  const base = getAppBaseUrl();
  const link = `${base}/?tab=settings`;
  const fanLine = fanName ? ` <strong>${esc(fanName)}</strong> estaba en el checkout.` : ' Un fan estaba en el checkout.';
  const html = layout(`
    <p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#fff;">Literal: alguien quiso darte dinero hoy.</p>
    <p style="margin:0 0 16px;">${fanLine} Y no pudo cerrar porque <strong>no tienes Mercado Pago bien configurado</strong> en Bizponzor.</p>
    <p style="margin:0 0 16px;color:#fbbf24;font-weight:700;">Estás perdiendo dinero en tiempo real.</p>
    <p style="margin:0 0 20px;">Activa tu cobro ahora. Dos minutos y vuelves a estar en juego.</p>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#22c55e;color:#0f172a;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Conectar Mercado Pago ahora →</a></p>
    <p style="margin:0;color:#94a3b8;font-size:14px;">— El equipo Bizponzor (sin vueltas)</p>
  `);
  const r = await sendEmail({
    to: creator.email,
    subject: 'Alguien intentó pagarte… y no pudo',
    html
  });
  if (r.ok) await logEmailSent(db, creator.id, 'checkout_mp_blocked');
}

/** 24h sin MP y sin contenido (lo dispara el job) */
async function sendActivationReminderEmail(db, user) {
  if (!user || !user.email) return;
  const base = getAppBaseUrl();
  const link = `${base}/`;
  const html = layout(`
    <p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#fff;">Tu perfil existe… pero no está generando nada.</p>
    <p style="margin:0 0 16px;">Tienes la cuenta. Lo que falta es movimiento: sin contenido y sin cobros activos, internet no te va a pagar sola.</p>
    <p style="margin:0 0 12px;font-weight:700;">Checklist rápido:</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#cbd5e1;">
      <li>Subir contenido (aunque sea poco, pero ya)</li>
      <li>Activar pagos con Mercado Pago</li>
      <li>Compartir tu perfil como si fuera un lanzamiento</li>
    </ul>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#0ea5e9);color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Activar mi perfil ahora →</a></p>
    <p style="margin:0;color:#94a3b8;font-size:14px;">Cupos de atención limitados. Prioriza hoy.</p>
  `);
  const r = await sendEmail({
    to: user.email,
    subject: 'Tu perfil existe… pero no está generando nada',
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
  const html = layout(`
    <p style="margin:0 0 12px;font-size:20px;font-weight:800;color:#fff;">💸 Nuevo suscriptor — esto ya empezó</p>
    <p style="margin:0 0 16px;"><strong>${esc(fanName)}</strong> decidió pagarte hoy. Plan: <strong>${esc(planName)}</strong>.</p>
    <p style="margin:0 0 16px;">Esto es solo el inicio si sigues publicando, respondiendo y empujando tu perfil.</p>
    <p style="margin:0;color:#94a3b8;font-size:14px;">Sigue. El algoritmo favorece a quien mueve el tablero.</p>
  `);
  const r = await sendEmail({
    to: creator.email,
    subject: '💸 Nuevo suscriptor – esto ya empezó',
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
    <p style="margin:0 0 12px;font-size:18px;font-weight:800;color:#fff;">Estás a un paso de generar ingresos</p>
    <p style="margin:0 0 16px;">Tu perfil ya puede cobrar. Si aún no ves dinero, casi siempre es por una de estas tres: poco contenido, cero conversación con fans, o cero visibilidad.</p>
    <p style="margin:0 0 12px;font-weight:700;">Hoy haz esto:</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#cbd5e1;">
      <li>Sube algo nuevo (foto, video o texto con gancho)</li>
      <li>Responde mensajes: ahí se cierran suscripciones</li>
      <li>Revisa que tu perfil sea visible en Descubrir si quieres tráfico nuevo</li>
    </ul>
    <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:12px;">Ir a mi dashboard →</a></p>
    <p style="margin:0;color:#94a3b8;font-size:14px;">Pequeños movimientos. Resultados reales.</p>
  `);
  const r = await sendEmail({
    to: user.email,
    subject: 'Estás a un paso de generar ingresos',
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
  sendActivationReminderEmail,
  sendNewSubscriberEmail,
  sendRevenueNudgeEmail,
  notifyNewSubscriberIfPaid
};
