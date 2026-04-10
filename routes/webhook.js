
const router = require('express').Router();
const db = require('../db');
const {
  getPreApprovalClient,
  mapPreapprovalStatusToDb,
  normalizePreapprovalPayload
} = require('../lib/mpSubscription');

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

  const sub = db
    .prepare(
      `SELECT * FROM subscriptions WHERE id = ? OR mp_subscription_id = ? LIMIT 1`
    )
    .get(externalRef, mpId);

  if (!sub) {
    console.warn('[WEBHOOK] No hay fila local para PreApproval', { externalRef, mpId });
    return;
  }

  if (dbStatus === 'active' && nextBilling) {
    db.prepare(
      `UPDATE subscriptions
       SET status = ?,
           mp_subscription_id = ?,
           mp_preapproval_status = ?,
           next_billing = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(dbStatus, mpId, mpStatus, nextBilling, sub.id);
  } else {
    db.prepare(
      `UPDATE subscriptions
       SET status = ?,
           mp_subscription_id = ?,
           mp_preapproval_status = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(dbStatus, mpId, mpStatus, sub.id);
  }

  console.log('[WEBHOOK] Suscripción actualizada', { local_id: sub.id, dbStatus, mpStatus });
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

  if (isPreapproval || action === 'updated' || action === 'created') {
    await syncSubscriptionFromPreapproval(id);
    return;
  }

  if (topicStr === 'payment' || topicStr.includes('payment')) {
    console.log('[WEBHOOK] Notificación payment (legacy); id=', id);
    // Opcional: integrar Payment.get para conciliar; PreApproval es el flujo principal.
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
