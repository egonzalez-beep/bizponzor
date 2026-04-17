/**
 * Exige que un fan tenga suscripción activa con un creador concreto.
 * Los creadores pasan sin comprobar suscripción.
 *
 * Uso: router.get('/algo/:creatorId', auth, requireActiveFanSubscription('creatorId'), handler)
 *
 * @param {string} paramName - nombre del parámetro en req.params (ej. 'creatorId')
 */
function requireActiveFanSubscription(paramName = 'creatorId') {
  const db = require('../db');

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Autenticación requerida' });
      }
      if (req.user.role === 'creator') {
        return next();
      }
      if (req.user.role !== 'fan') {
        return res.status(403).json({ error: 'Solo fans o creadores' });
      }

      const creatorId = req.params[paramName] || req.body[paramName] || req.query[paramName];
      if (!creatorId) {
        return res.status(400).json({ error: 'Falta creator_id' });
      }

      const row = await db
        .prepare(
          `SELECT id FROM subscriptions
           WHERE fan_id = ? AND creator_id = ? AND status = 'active'
           LIMIT 1`
        )
        .get(req.user.id, creatorId);

      if (!row) {
        console.warn('[requireActiveFanSubscription] Sin suscripción activa', {
          fan_id: req.user.id,
          creator_id: creatorId
        });
        return res.status(403).json({
          error: 'Suscripción requerida',
          code: 'SUBSCRIPTION_REQUIRED'
        });
      }

      next();
    } catch (e) {
      console.error('[requireActiveFanSubscription]', e);
      return res.status(500).json({ error: 'Error al verificar suscripción' });
    }
  };
}

/**
 * Exige que el fan tenga al menos una suscripción activa (cualquier creador).
 */
async function requireAnyActiveFanSubscription(req, res, next) {
  const db = require('../db');

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Autenticación requerida' });
    }
    if (req.user.role === 'creator') {
      return next();
    }
    if (req.user.role !== 'fan') {
      return res.status(403).json({ error: 'Solo fans o creadores' });
    }

    const row = await db
      .prepare(`SELECT id FROM subscriptions WHERE fan_id = ? AND status = 'active' LIMIT 1`)
      .get(req.user.id);

    if (!row) {
      return res.status(403).json({
        error: 'Necesitas una suscripción activa',
        code: 'NO_ACTIVE_SUBSCRIPTION'
      });
    }
    next();
  } catch (e) {
    console.error('[requireAnyActiveFanSubscription]', e);
    return res.status(500).json({ error: 'Error al verificar suscripción' });
  }
}

module.exports = {
  requireActiveFanSubscription,
  requireAnyActiveFanSubscription
};
