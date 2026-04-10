const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const {
  getPreferenceClient,
  normalizeMpPayload
} = require('../lib/mpPreference');

const APP_URL = 'https://bizponzor-production.up.railway.app';
const MIN_DONATION = 10;

const isValidEmail = (email) =>
  typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

router.post('/checkout', auth, async (req, res) => {
  try {
    if (req.user.role !== 'fan') {
      return res.status(403).json({ error: 'Solo fans pueden donar' });
    }
    if (!req.user || !isValidEmail(req.user.email)) {
      return res.status(400).json({
        success: false,
        error: 'Tu cuenta tiene un email inválido. Actualízalo antes de continuar.'
      });
    }
    const { creator_id, amount } = req.body;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < MIN_DONATION) {
      return res.status(400).json({
        success: false,
        error: `El monto mínimo de donación es $${MIN_DONATION} MXN`
      });
    }
    const creator = db
      .prepare("SELECT id, name FROM users WHERE id=? AND role='creator'")
      .get(creator_id);
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });

    const donationId = uuidv4();
    db.prepare(
      `INSERT INTO donations (id, fan_id, creator_id, amount, currency_id, status)
       VALUES (?,?,?,?,?,?)`
    ).run(donationId, req.user.id, creator_id, amt, 'MXN', 'pending');

    const preferenceClient = getPreferenceClient();
    if (!preferenceClient) {
      return res.status(500).json({ error: 'Mercado Pago no configurado' });
    }

    const body = {
      items: [
        {
          title: `Donación a ${creator.name} — BizPonzor`,
          quantity: 1,
          unit_price: amt,
          currency_id: 'MXN'
        }
      ],
      payer: { email: req.user.email },
      external_reference: donationId,
      back_urls: {
        success: `${APP_URL}/success?donation=${encodeURIComponent(donationId)}`,
        failure: `${APP_URL}/`,
        pending: `${APP_URL}/success?donation=${encodeURIComponent(donationId)}`
      },
      notification_url: `${APP_URL}/api/webhook/mp`,
      statement_descriptor: 'BIZPONZOR'
    };

    console.log('[donations] Creando preferencia', { donationId, amount: amt });

    const raw = await preferenceClient.create({ body });
    const pref = normalizeMpPayload(raw) || raw;
    const prefId = pref.id;
    if (prefId) {
      db.prepare('UPDATE donations SET mp_preference_id = ? WHERE id = ?').run(
        String(prefId),
        donationId
      );
    }
    const checkoutUrl = pref.init_point || pref.sandbox_init_point;
    return res.json({
      checkout_url: checkoutUrl,
      donation_id: donationId,
      preference_id: prefId
    });
  } catch (e) {
    console.error('[donations/checkout]', e);
    return res.status(500).json({ error: e.message || 'Error al crear donación' });
  }
});

router.get('/my', auth, (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  const rows = db
    .prepare(
      `SELECT d.id, d.amount, d.currency_id, d.status, d.created_at,
              u.name as fan_name, u.email as fan_email
       FROM donations d
       JOIN users u ON d.fan_id = u.id
       WHERE d.creator_id = ? AND d.status = 'completed'
       ORDER BY d.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

router.get('/summary', auth, (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  const total = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM donations
       WHERE creator_id = ? AND status = 'completed'`
    )
    .get(req.user.id);
  res.json({ total_donations: total.total });
});

module.exports = router;
