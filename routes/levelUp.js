const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

/**
 * POST /api/level-up/click
 * Registro simple de interés (CTA WhatsApp). Solo creadores autenticados.
 */
router.post('/click', auth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'creator') {
      return res.status(403).json({ error: 'Solo creadores' });
    }
    const id = uuidv4();
    await db
      .prepare(
        `INSERT INTO level_up_events (id, user_id, created_at) VALUES (?, ?, datetime('now'))`
      )
      .run(id, req.user.id);
    res.json({ success: true });
  } catch (e) {
    console.error('[level-up/click]', e);
    res.status(500).json({ error: 'No se pudo registrar' });
  }
});

module.exports = router;
