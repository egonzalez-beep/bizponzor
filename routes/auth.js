
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, handle } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'Campos requeridos' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const userHandle = handle || '@' + email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g,'');
    db.prepare('INSERT INTO users (id, name, email, password, role, handle) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, email, hash, role, userHandle);
    // Crear planes demo para creadores
    if (role === 'creator') {
      const plans = [
        { id: uuidv4(), name: 'Basico', price: 5, features: JSON.stringify(['Acceso al feed de fotos','Contenido exclusivo basico','Newsletter mensual']), is_featured: 0 },
        { id: uuidv4(), name: 'Premium', price: 12, features: JSON.stringify(['Todo lo del plan Basico','Acceso a todos los videos','Contenido BTS exclusivo','Descarga de archivos']), is_featured: 1 },
        { id: uuidv4(), name: 'VIP', price: 25, features: JSON.stringify(['Todo lo del plan Premium','Menciones en stories','Acceso anticipado','Contenido personalizado']), is_featured: 0 }
      ];
      const stmt = db.prepare('INSERT INTO plans (id, creator_id, name, price, features, is_featured) VALUES (?,?,?,?,?,?)');
      plans.forEach(p => stmt.run(p.id, id, p.name, p.price, p.features, p.is_featured));
    }
    const token = jwt.sign({ id, name, email, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, name, email, role, handle: userHandle } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, handle: user.handle, avatar_url: user.avatar_url } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, handle, bio, category, avatar_url, banner_url FROM users WHERE id = ?').get(req.user.id);
  res.json(user);
});

router.put('/profile', require('../middleware/auth'), (req, res) => {
  const { name, bio, category } = req.body;
  db.prepare('UPDATE users SET name=?, bio=?, category=? WHERE id=?').run(name, bio, category, req.user.id);
  res.json({ success: true });
});

module.exports = router;
