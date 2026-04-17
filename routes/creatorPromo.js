const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

function requireCreator(req, res, next) {
  if (!req.user || req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  next();
}

/**
 * POST /api/creator/promo-codes
 */
router.post('/promo-codes', auth, requireCreator, async (req, res) => {
  try {
    const { code, duration_days, max_uses } = req.body;
    const codeNorm = String(code || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    if (!codeNorm || codeNorm.length < 3) {
      return res.status(400).json({ error: 'Código inválido (mín. 3 caracteres)' });
    }

    const days = Math.min(365, Math.max(1, parseInt(duration_days, 10) || 7));
    const max = Math.min(10000, Math.max(1, parseInt(max_uses, 10) || 1));

    const id = uuidv4();
    await db
      .prepare(
        `INSERT INTO promo_codes (
        id, creator_id, code, discount_percent, duration_days, max_uses, used_count, expires_at, is_active
      ) VALUES (?, ?, ?, 100, ?, ?, 0, NULL, 1)`
      )
      .run(id, req.user.id, codeNorm, days, max);

    res.json({
      success: true,
      id,
      code: codeNorm,
      duration_days: days,
      max_uses: max
    });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Ese código ya existe' });
    }
    res.status(500).json({ error: e.message || 'Error al crear código' });
  }
});

/**
 * GET /api/creator/promo-codes
 */
router.get('/promo-codes', auth, requireCreator, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT id, code, used_count, max_uses, duration_days, expires_at, is_active, created_at
       FROM promo_codes
       WHERE creator_id = ?
       ORDER BY created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

/**
 * GET /api/creator/promo-codes/:codeId/redemptions
 */
router.get('/promo-codes/:codeId/redemptions', auth, requireCreator, async (req, res) => {
  const { codeId } = req.params;
  const promo = await db.prepare('SELECT id, creator_id FROM promo_codes WHERE id = ?').get(codeId);
  if (!promo || promo.creator_id !== req.user.id) {
    return res.status(404).json({ error: 'Código no encontrado' });
  }

  const rows = await db
    .prepare(
      `SELECT
         u.email AS fan_email,
         r.created_at AS redeemed_at,
         (SELECT next_billing FROM subscriptions
          WHERE fan_id = r.fan_id AND creator_id = ?
          ORDER BY datetime(created_at) DESC LIMIT 1) AS access_until
       FROM promo_redemptions r
       JOIN users u ON u.id = r.fan_id
       WHERE r.promo_code_id = ?
       ORDER BY r.created_at DESC`
    )
    .all(req.user.id, codeId);

  res.json(rows);
});

module.exports = router;
