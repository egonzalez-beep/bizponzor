
const router = require('express').Router();
const db = require('../db');
const { createNotification } = require('../lib/createNotification');
const {
  getPreApprovalClient,
  mapPreapprovalStatusToDb,
  normalizePreapprovalPayload
} = require('../lib/mpSubscription');
const { getPaymentClient, normalizeMpPayload } = require('../lib/mpPreference');
const { notifyNewSubscriberIfPaid } = require('../lib/creatorEmails');

/**
 * Extrae topic e id de notificaciones MP (GET query o POST body).
 */
function extractNotificationPayload(req) {
  const q = req.query || {};
  const b = req.body || {};

  const topic =
    q.topic ||
    b.topic ||
    b.type ||
    (typeof b.type === 'string' ? b.type : null);

  const id =
    q.id ||
    q['data.id'] ||
    b.id ||
    (b.data && (b.data.id ?? b.data['id'])) ||
    null;

  const action = b.action || q.action;

  return { topic, id, action, raw: b };
}

async function syncSubscriptionFromPreapproval(mpPreapprovalId) {
  const preApprovalClient = getPreApprovalClient();
  if (!preApprovalClient) {
    console.warn('[WEBHOOK] MP_ACCESS_TOKEN no configurado; no se consulta PreApproval');
    return;
  }

  const raw = await preApprovalClient.get({ id: String(mpPreapprovalId) });
  const data = normalizePreapprovalPayload(raw) || raw;
  const mpStatus = data.status || data.response?.status;
  const externalRef =
    data.external_reference || data.external_reference_id || data.external_id;
  const mpId = String(data.id || mpPreapprovalId);

  console.log('[WEBHOOK] PreApproval GET', {
    id: mpId,
    status: mpStatus,
    external_reference: externalRef
  });

  const dbStatus = mapPreapprovalStatusToDb(mpStatus);

  let nextBilling = null;
  if (dbStatus === 'active') {
    const nb = new Date();
    nb.setMonth(nb.getMonth() + 1);
    nextBilling = nb.toISOString();
  }

  const sub = await db
    .prepare(`SELECT * FROM subscriptions WHERE id = ? OR mp_subscription_id = ? LIMIT 1`)
    .get(externalRef, mpId);

  if (!sub) {
    console.warn('[WEBHOOK] No hay fila local para PreApproval', { externalRef, mpId });
    return;
  }

  if (dbStatus === 'active' && nextBilling) {
    await db
      .prepare(
        `UPDATE subscriptions
       SET status = ?,
           mp_subscription_id = ?,
           mp_preapproval_status = ?,
           next_billing = ?,
           cancel_at_period_end = FALSE,
           updated_at = datetime('now')
       WHERE id = ?`
      )
      .run(dbStatus, mpId, mpStatus, nextBilling, sub.id);
  } else if (dbStatus === 'cancelled') {
    const nb = sub.next_billing ? new Date(sub.next_billing) : null;
    const stillInPaidPeriod = nb && !Number.isNaN(nb.getTime()) && nb.getTime() > Date.now();
    if (stillInPaidPeriod) {
      await db
        .prepare(
          `UPDATE subscriptions
         SET cancel_at_period_end = TRUE,
             mp_subscription_id = ?,
             mp_preapproval_status = ?,
             updated_at = datetime('now')
         WHERE id = ?`
        )
        .run(mpId, mpStatus, sub.id);
    } else {
      await db
        .prepare(
          `UPDATE subscriptions
         SET status = ?,
             mp_subscription_id = ?,
             mp_preapproval_status = ?,
             updated_at = datetime('now')
         WHERE id = ?`
        )
        .run(dbStatus, mpId, mpStatus, sub.id);
    }
  } else {
    await db
      .prepare(
        `UPDATE subscriptions
       SET status = ?,
           mp_subscription_id = ?,
           mp_preapproval_status = ?,
           updated_at = datetime('now')
       WHERE id = ?`
      )
      .run(dbStatus, mpId, mpStatus, sub.id);
  }

  if (dbStatus === 'active') {
    const fan = await db.prepare('SELECT name FROM users WHERE id = ?').get(sub.fan_id);
    const plan = await db.prepare('SELECT name FROM plans WHERE id = ?').get(sub.plan_id);
    createNotification({
      userId: sub.creator_id,
      type: 'NEW_SUBSCRIBER',
      metadata: { fanName: fan?.name, planName: plan?.name },
      dedupeKey: `sub-active-${sub.id}`
    }).catch(() => null);
    void notifyNewSubscriberIfPaid(db, sub.id).catch(() => null);
  }

  console.log('[WEBHOOK] Suscripción actualizada', { local_id: sub.id, dbStatus, mpStatus });
}

async function syncDonationFromPayment(mpPaymentId) {
  const paymentClient = getPaymentClient();
  if (!paymentClient) {
    console.warn('[WEBHOOK] MP_ACCESS_TOKEN no configurado; no se consulta Payment');
    return;
  }
  const raw = await paymentClient.get({ id: String(mpPaymentId) });
  const pay = normalizeMpPayload(raw) || raw;
  const extRef = pay.external_reference;
  const status = pay.status;
  const mpId = String(pay.id || mpPaymentId);

  console.log('[WEBHOOK] Payment GET', {
    id: mpId,
    status,
    external_reference: extRef
  });

  if (!extRef) return;

  const donation = await db.prepare('SELECT * FROM donations WHERE id = ?').get(extRef);
  if (!donation) return;
  if (donation.status === 'completed') return;

  if (status === 'approved') {
    await db.prepare(`UPDATE donations SET status = 'completed', mp_payment_id = ? WHERE id = ?`).run(mpId, extRef);
    const fan = await db.prepare('SELECT name FROM users WHERE id = ?').get(donation.fan_id);
    createNotification({
      userId: donation.creator_id,
      type: 'NEW_DONATION',
      metadata: {
        senderName: fan?.name,
        amount: donation.amount,
        currency: donation.currency_id || 'MXN'
      },
      dedupeKey: `donation-done-${extRef}`
    }).catch(() => null);
    console.log('[WEBHOOK] Donación completada', { id: extRef });
  } else if (status === 'rejected' || status === 'cancelled' || status === 'refunded') {
    await db.prepare(`UPDATE donations SET status = 'failed' WHERE id = ?`).run(extRef);
    console.log('[WEBHOOK] Donación no aprobada', { id: extRef, status });
  }
}

async function processMercadoPagoWebhook(req) {
  const { topic, id, action } = extractNotificationPayload(req);

  console.log('[WEBHOOK] Payload', { topic, id, action });

  if (!id) {
    console.log('[WEBHOOK] Sin id; ignorado');
    return;
  }

  const topicStr = String(topic || '').toLowerCase();
  const isPreapproval =
    topicStr === 'preapproval' ||
    topicStr.includes('preapproval') ||
    topicStr === 'subscription_preapproval' ||
    topicStr === 'subscription_preapproved';

  if (isPreapproval) {
    await syncSubscriptionFromPreapproval(id);
    return;
  }

  if (topicStr === 'payment' || topicStr.includes('payment')) {
    await syncDonationFromPayment(id);
    return;
  }
}

async function handleWebhook(req, res) {
  try {
    await processMercadoPagoWebhook(req);
    return res.sendStatus(200);
  } catch (e) {
    console.error('[WEBHOOK] Error:', e.message, e.stack);
    return res.sendStatus(200);
  }
}

router.post('/mp', handleWebhook);
router.get('/mp', handleWebhook);

module.exports = router;
