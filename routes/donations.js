const crypto = require('crypto');
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
    const creator = await db
      .prepare("SELECT id, name FROM users WHERE id=? AND role='creator'")
      .get(creator_id);
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });

    console.log('[AUDIT] Intento de pago:', {
      timestamp: new Date().toISOString(),
      creator_id,
      type: 'donation',
      action: 'init_checkout'
    });

    const account = await db.prepare(`
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

    const collectorId = account?.mp_user_id;
    const collectorIdNum =
      collectorId != null && String(collectorId).trim() !== ''
        ? Number(String(collectorId).trim())
        : NaN;

    if (
      !account ||
      !Number.isFinite(collectorIdNum) ||
      collectorIdNum <= 0 ||
      !/^\d+$/.test(String(collectorId).trim())
    ) {
      return res.status(400).json({
        error: 'El creador no tiene una cuenta de Mercado Pago configurada correctamente'
      });
    }

    const donationId = uuidv4();
    await db
      .prepare(
        `INSERT INTO donations (id, fan_id, creator_id, amount, currency_id, status)
       VALUES (?,?,?,?,?,?)`
      )
      .run(donationId, req.user.id, creator_id, amt, 'MXN', 'pending');

    const preferenceClient = getPreferenceClient();
    if (!preferenceClient) {
      return res.status(500).json({ error: 'Mercado Pago no configurado' });
    }

    const marketplaceFee = Math.round(amt * 0.1);

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
      statement_descriptor: 'BIZPONZOR',
      collector_id: collectorIdNum,
      marketplace_fee: marketplaceFee
    };

    console.log('[MP] Donación marketplace:', {
      creator_id,
      collector_id: collectorIdNum,
      fee: marketplaceFee
    });
    console.log('[donations] Creando preferencia', { donationId, amount: amt });

    const raw = await preferenceClient.create({ body });
    const pref = normalizeMpPayload(raw) || raw;
    const prefId = pref.id;
    if (prefId) {
      await db.prepare('UPDATE donations SET mp_preference_id = ? WHERE id = ?').run(
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
    console.error('[MP][ERROR] Falló la creación:', e.message);
    return res.status(500).json({ error: e.message || 'Error al crear donación' });
  }
});

async function listReceivedDonations(req, res) {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  const rows = await db
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
}

router.get('/my', auth, listReceivedDonations);
/** Alias solicitado por el cliente (misma respuesta que GET /donations/my) */
router.get('/received', auth, listReceivedDonations);

router.get('/summary', auth, async (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  const total = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM donations
       WHERE creator_id = ? AND status = 'completed'`
    )
    .get(req.user.id);
  res.json({ total_donations: total.total });
});

module.exports = router;
