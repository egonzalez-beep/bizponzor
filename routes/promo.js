const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

/** Evita FOREIGN KEY al canjear si el JWT existe pero la fila en `users` no (p. ej. móvil / réplica). */
function ensureFanUserRow(req) {
  const userId = req.user?.id;
  if (!userId) return false;
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (exists) return true;

  const emailRaw = req.user.email;
  const name = req.user.name || 'Usuario';
  const email = emailRaw ? String(emailRaw).trim().toLowerCase() : '';

  if (email) {
    const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (byEmail && byEmail.id !== userId) {
      console.error('[promo/redeem] fan repair blocked: email belongs to another id', {
        tokenUserId: userId,
        dbUserId: byEmail.id,
        email
      });
      return false;
    }
  }

  const safeHandle = '@fan_' + uuidv4().replace(/-/g, '').slice(0, 14);
  const passwordPlaceholder = 'TOKEN_ONLY_' + uuidv4();

  try {
    db.prepare('INSERT INTO users (id, name, email, password, role, handle) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId,
      name,
      email || userId + '@token.local',
      passwordPlaceholder,
      'fan',
      safeHandle
    );
    console.warn('[promo/redeem] inserted missing fan row for FK', { userId });
    return true;
  } catch (e) {
    console.error('[promo/redeem] fan repair insert failed', e);
    return false;
  }
}

/**
 * POST /api/promo/redeem
 * Body: { code, creator_id }
 */
router.post('/redeem', auth, (req, res) => {
  if (req.user.role !== 'fan') {
    return res.status(403).json({ success: false, error: 'Solo los fans pueden canjear códigos' });
  }

  if (!ensureFanUserRow(req)) {
    return res.json({
      success: false,
      error: 'No pudimos sincronizar tu cuenta. Cierra sesión e inicia sesión de nuevo.'
    });
  }

  const { code, creator_id } = req.body;
  const fanId = req.user.id;

  if (!creator_id || typeof creator_id !== 'string') {
    return res.json({ success: false, error: 'creator_id requerido' });
  }

  const creatorOk = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'creator'").get(creator_id);
  if (!creatorOk) {
    return res.json({
      success: false,
      error: 'Creador no encontrado. Recarga el perfil e inténtalo de nuevo.'
    });
  }

  const codeNorm = String(code || '')
    .trim()
    .toUpperCase();
  if (!codeNorm) {
    return res.json({ success: false, error: 'Ingresa un código' });
  }

  const tx = db.transaction(() => {
    const promo = db
      .prepare(
        `SELECT * FROM promo_codes
         WHERE code = ?
           AND is_active = 1
           AND (expires_at IS NULL OR expires_at > datetime('now'))
           AND used_count < max_uses`
      )
      .get(codeNorm);

    if (!promo) throw new Error('Código inválido o expirado');

    if (promo.creator_id !== creator_id) {
      throw new Error('Código no válido para este creador');
    }

    if (Number(promo.discount_percent) < 100) {
      throw new Error('Descuentos parciales disponibles próximamente');
    }

    const alreadyUsed = db
      .prepare(
        `SELECT 1 FROM promo_redemptions
         WHERE promo_code_id = ? AND fan_id = ?`
      )
      .get(promo.id, fanId);

    if (alreadyUsed) {
      throw new Error('Este código ya fue utilizado');
    }

    const existingSub = db
      .prepare(
        `SELECT 1 FROM subscriptions
         WHERE fan_id = ? AND creator_id = ? AND status = 'active'`
      )
      .get(fanId, creator_id);

    if (existingSub) {
      throw new Error('Ya tienes acceso activo');
    }

    const plan = db
      .prepare(
        `SELECT id FROM plans
         WHERE creator_id = ? AND active = 1
         ORDER BY is_featured DESC, price DESC
         LIMIT 1`
      )
      .get(creator_id);

    if (!plan) {
      throw new Error('El creador no tiene planes activos');
    }

    const redemptionId = uuidv4();
    db.prepare(
      `INSERT INTO promo_redemptions (id, promo_code_id, fan_id)
       VALUES (?, ?, ?)`
    ).run(redemptionId, promo.id, fanId);

    db.prepare(`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?`).run(promo.id);

    const dayMod = '+' + String(parseInt(promo.duration_days, 10) || 7) + ' days';
    const accessRow = db.prepare(`SELECT datetime('now', ?) AS d`).get(dayMod);
    const accessUntil = accessRow.d;

    const subId = uuidv4();
    db.prepare(
      `INSERT INTO subscriptions (
        id, fan_id, creator_id, plan_id, status, amount, next_billing,
        promo_code, discount_percent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', 0, ?, ?, 100, datetime('now'), datetime('now'))`
    ).run(subId, fanId, creator_id, plan.id, accessUntil, codeNorm);

    return { success: true, access_until: accessUntil };
  });

  try {
    const result = tx();
    return res.json(result);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (/FOREIGN KEY|constraint failed/i.test(msg)) {
      console.error('[promo/redeem] constraint', msg);
      return res.json({
        success: false,
        error:
          'No se pudo completar el canje. Cierra sesión, vuelve a entrar e inténtalo de nuevo. Si persiste, contacta soporte.'
      });
    }
    return res.json({ success: false, error: msg || 'Error al canjear' });
  }
});

module.exports = router;
