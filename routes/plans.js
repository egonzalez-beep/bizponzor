
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');

router.get('/:creatorId', (req, res) => {
  const plans = db
    .prepare(
      'SELECT * FROM plans WHERE creator_id=? AND active=1 ORDER BY is_featured DESC, price ASC'
    )
    .all(req.params.creatorId);
  res.json(plans.map(p => ({ ...p, features: JSON.parse(p.features || '[]') })));
});

router.post('/', auth, (req, res) => {
  if (req.user.role !== 'creator') return res.status(403).json({ error: 'Solo creadores' });
  const { name, price, currency, description, features, is_featured } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO plans (id, creator_id, name, price, currency, description, features, is_featured) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, name, price, currency || 'USD', description || '', JSON.stringify(features || []), is_featured ? 1 : 0);
  res.json({ id, name, price });
});

router.put('/:id', auth, (req, res) => {
  const { name, price, description, features, is_featured, active } = req.body;
  db.prepare('UPDATE plans SET name=?, price=?, description=?, features=?, is_featured=?, active=? WHERE id=? AND creator_id=?')
    .run(name, price, description || '', JSON.stringify(features || []), is_featured ? 1 : 0, active !== false ? 1 : 0, req.params.id, req.user.id);
  res.json({ success: true });
});

router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM plans WHERE id=? AND creator_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
