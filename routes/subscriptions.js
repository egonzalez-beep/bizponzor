const crypto = require('crypto');
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const { normalizePreapprovalPayload } = require('../lib/mpSubscription');

const MP_CURRENCY = process.env.MP_CURRENCY_ID || 'MXN';
const APP_URL = 'https://bizponzor-production.up.railway.app';
const MIN_AMOUNT = 10;

const isValidEmail = (email) => {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * POST /api/subscriptions/checkout
 * Crea fila pending en DB y luego PreApproval en Mercado Pago (suscripción recurrente real).
 * No usa Preference ni auto_return.
 */
router.post('/checkout', auth, async (req, res) => {
  try {
    if (req.user.role !== 'fan') {
      return res.status(403).json({ error: 'Solo fans pueden suscribirse' });
    }

    const { plan_id, creator_id } = req.body;
    const plan = db
      .prepare('SELECT * FROM plans WHERE id=? AND creator_id=? AND active=1')
      .get(plan_id, creator_id);
    const creator = db
      .prepare('SELECT id, name FROM users WHERE id=? AND role=?')
      .get(creator_id, 'creator');

    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });

    if (!req.user || !isValidEmail(req.user.email)) {
      console.error('[MP] Email inválido:', req.user?.email);

      return res.status(400).json({
        success: false,
        error: 'Tu cuenta tiene un email inválido. Actualízalo antes de continuar.'
      });
    }

    const amount = Number(plan.price);

    if (amount === 0) {
      const sub_id = uuidv4();
      const nextBilling = new Date();
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      db.prepare(
        `INSERT INTO subscriptions (id, fan_id, creator_id, plan_id, status, amount, next_billing)
         VALUES (?,?,?,?,?,?,?)`
      ).run(sub_id, req.user.id, creator_id, plan_id, 'active', 0, nextBilling.toISOString());
      console.log('[checkout] suscripción gratuita activa', { sub_id, fan_id: req.user.id, plan_id });
      return res.json({ success: true, sub_id, free: true });
    }

    if (amount < MIN_AMOUNT) {
      console.error('[MP] Monto inválido:', amount);

      return res.status(400).json({
        success: false,
        error: 'El monto mínimo de suscripción es $10 MXN'
      });
    }

    console.log('[AUDIT] Intento de pago:', {
      timestamp: new Date().toISOString(),
      creator_id,
      type: 'subscription',
      action: 'init_checkout'
    });

    const account = db.prepare(`
      SELECT user_id, access_token, mp_user_id
      FROM mercado_pago_accounts
      WHERE user_id = ?
    `).get(creator_id);

    console.log('[MP] Account Check:', account ? {
      user_id: account.user_id,
      mp_user_id: account.mp_user_id,
      has_token: !!account.access_token,
      token_hash: account.access_token
        ? crypto.createHash('sha256')
          .update(account.access_token)
          .digest('hex')
          .substring(0, 10)
        : null
    } : null);

    if (
      !account ||
      !account.access_token ||
      typeof account.access_token !== 'string' ||
      account.access_token.length < 20
    ) {
      return res.status(400).json({
        error: 'El creador no tiene una cuenta de Mercado Pago válida'
      });
    }

    const sub_id = uuidv4();

    db.prepare(
      `INSERT INTO subscriptions (id, fan_id, creator_id, plan_id, status, amount)
       VALUES (?,?,?,?,?,?)`
    ).run(sub_id, req.user.id, creator_id, plan_id, 'pending', amount);

    const preApprovalClient = new PreApproval(
      new MercadoPagoConfig({
        accessToken: account.access_token,
        options: { timeout: 15000 }
      })
    );

    const startDate = new Date();
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 2);

    const body = {
      reason: `BizPonzor — ${plan.name} · ${creator.name}`,
      payer_email: req.user.email,
      external_reference: sub_id,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: amount,
        currency_id: MP_CURRENCY,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString()
      },
      back_url: `${APP_URL}/success?sub=${sub_id}`,
      notification_url: `${APP_URL}/api/webhook/mp`
    };

    try {
      const rawMp = await preApprovalClient.create({ body });
      const mpResponse = normalizePreapprovalPayload(rawMp) || rawMp;
      const mpId = mpResponse.id;
      const checkoutUrl =
        mpResponse.init_point || mpResponse.sandbox_init_point;

      if (mpId) {
        db.prepare(
          `UPDATE subscriptions SET mp_subscription_id = ?, mp_preapproval_status = ?
           WHERE id = ?`
        ).run(String(mpId), mpResponse.status || 'pending', sub_id);
      }

      console.log('[MP] Suscripción usando token del creador:', creator_id);
      console.log('[MP][checkout] PreApproval creado', {
        creator_id,
        sub_id,
        preapproval_id: mpId,
        status: mpResponse.status
      });

      return res.json({
        checkout_url: checkoutUrl,
        preapproval_id: mpId,
        sub_id,
        mp_status: mpResponse.status
      });
    } catch (error) {
      console.error('[MP][ERROR] Falló la creación:', error.message);
      return res.status(500).json({
        error: 'Error al crear suscripción en Mercado Pago',
        detail: error.message
      });
    }
  } catch (e) {
    console.error('[checkout]', e);
    return res.status(500).json({ error: e.message || 'Error interno' });
  }
});

router.post('/activate/:sub_id', auth, (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.sub_id);
  if (!sub) return res.status(404).json({ error: 'No encontrado' });
  const nextBilling = new Date();
  nextBilling.setMonth(nextBilling.getMonth() + 1);
  db.prepare(
    "UPDATE subscriptions SET status='active', next_billing=?, updated_at=datetime('now') WHERE id=?"
  ).run(nextBilling.toISOString(), sub.id);
  res.json({ success: true, status: 'active' });
});

router.get('/my', auth, (req, res) => {
  if (req.user.role === 'fan') {
    const subs = db
      .prepare(
        `SELECT s.*, u.name as creator_name, u.handle, u.avatar_url, p.name as plan_name, p.price
         FROM subscriptions s
         JOIN users u ON s.creator_id=u.id
         JOIN plans p ON s.plan_id=p.id
         WHERE s.fan_id=? AND s.status='active'`
      )
      .all(req.user.id);
    res.json(subs);
  } else {
    const subs = db
      .prepare(
        `SELECT s.*, u.name as fan_name, u.email as fan_email, p.name as plan_name, p.price
         FROM subscriptions s
         JOIN users u ON s.fan_id=u.id
         JOIN plans p ON s.plan_id=p.id
         WHERE s.creator_id=? AND s.status='active'`
      )
      .all(req.user.id);
    res.json(subs);
  }
});

router.post('/cancel/:id', auth, (req, res) => {
  db.prepare("UPDATE subscriptions SET status='cancelled' WHERE id=? AND fan_id=?").run(
    req.params.id,
    req.user.id
  );
  res.json({ success: true });
});

router.get('/stats', auth, (req, res) => {
  if (req.user.role !== 'creator') return res.status(403).json({ error: 'Solo creadores' });
  const total = db
    .prepare(
      "SELECT COUNT(*) as count FROM subscriptions WHERE creator_id=? AND status='active'"
    )
    .get(req.user.id);
  const revenue = db
    .prepare(
      "SELECT SUM(amount) as total FROM subscriptions WHERE creator_id=? AND status='active'"
    )
    .get(req.user.id);
  const content = db
    .prepare('SELECT COUNT(*) as count FROM content WHERE creator_id=?')
    .get(req.user.id);
  res.json({
    subscribers: total.count,
    monthly_revenue: revenue.total || 0,
    content_count: content.count
  });
});

module.exports = router;
