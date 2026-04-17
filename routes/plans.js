
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

async function primaryPlanId(creatorId) {
  const row = await db
    .prepare(
      `SELECT id FROM plans WHERE creator_id = ? AND active = 1
       ORDER BY is_featured DESC, created_at ASC LIMIT 1`
    )
    .get(creatorId);
  return row?.id;
}

router.get('/my', auth, async (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  const plan = await db
    .prepare(
      `SELECT price, name FROM plans WHERE creator_id = ? AND active = 1
       ORDER BY is_featured DESC, created_at ASC LIMIT 1`
    )
    .get(req.user.id);
  res.json(plan || { price: 0, name: 'BizPonzor Premium' });
});

router.post('/update-price', auth, async (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  const { price } = req.body;
  const p = parseInt(price, 10);
  if (Number.isNaN(p) || p < 0) {
    return res.status(400).json({ error: 'Precio inválido' });
  }
  if (p > 0 && p < 100) {
    return res.status(400).json({ error: 'El precio mínimo de pago es $100 MXN' });
  }

  const existingId = await primaryPlanId(req.user.id);

  if (existingId) {
    await db
      .prepare(`UPDATE plans SET price = ?, name = ?, currency = 'MXN', is_featured = 1 WHERE id = ?`)
      .run(p, 'BizPonzor Premium', existingId);
  } else {
    const id = uuidv4();
    await db
      .prepare(
        `INSERT INTO plans (id, creator_id, name, price, currency, description, features, is_featured, active)
       VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        req.user.id,
        'BizPonzor Premium',
        p,
        'MXN',
        '',
        JSON.stringify([]),
        1,
        1
      );
  }

  res.json({ success: true, price: p });
});

router.post('/set-free', auth, async (req, res) => {
  if (req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  const existingId = await primaryPlanId(req.user.id);

  if (existingId) {
    await db.prepare(`UPDATE plans SET price = 0, name = ?, currency = 'MXN' WHERE id = ?`).run(
      'Comunidad Gratuita',
      existingId
    );
  } else {
    const id = uuidv4();
    await db
      .prepare(
        `INSERT INTO plans (id, creator_id, name, price, currency, description, features, is_featured, active)
       VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        req.user.id,
        'Comunidad Gratuita',
        0,
        'MXN',
        '',
        JSON.stringify([]),
        1,
        1
      );
  }

  res.json({ success: true });
});

router.get('/:creatorId', async (req, res) => {
  const plans = await db
    .prepare('SELECT * FROM plans WHERE creator_id=? AND active=1 ORDER BY is_featured DESC, price ASC')
    .all(req.params.creatorId);
  res.json(plans.map((p) => ({ ...p, features: JSON.parse(p.features || '[]') })));
});

router.post('/', auth, async (req, res) => {
  if (req.user.role !== 'creator') return res.status(403).json({ error: 'Solo creadores' });
  const { name, price, currency, description, features, is_featured } = req.body;
  const id = uuidv4();
  await db
    .prepare(
      'INSERT INTO plans (id, creator_id, name, price, currency, description, features, is_featured) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(id, req.user.id, name, price, currency || 'USD', description || '', JSON.stringify(features || []), is_featured ? 1 : 0);
  res.json({ id, name, price });
});

router.put('/:id', auth, async (req, res) => {
  const { name, price, description, features, is_featured, active } = req.body;
  await db
    .prepare('UPDATE plans SET name=?, price=?, description=?, features=?, is_featured=?, active=? WHERE id=? AND creator_id=?')
    .run(
      name,
      price,
      description || '',
      JSON.stringify(features || []),
      is_featured ? 1 : 0,
      active !== false ? 1 : 0,
      req.params.id,
      req.user.id
    );
  res.json({ success: true });
});

router.delete('/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM plans WHERE id=? AND creator_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
