
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const upload = multer({ dest: 'uploads/' });

function getOnboardingStatus(user, stats) {
  const effectiveSteps = [
    { id: 'banner', done: !!user.banner_url },
    { id: 'bio', done: !!(user.bio && user.bio.trim().length >= 20) },
    { id: 'mercadopago', done: !!user.mp_user_id },
    { id: 'plan', done: user.has_plan === true },
    { id: 'first_post', done: (stats.total_posts || 0) > 0 }
  ];

  const allSteps = [
    {
      id: 'banner',
      name: 'Banner',
      icon: '🖼️',
      done: !!user.banner_url,
      action: 'Sube una imagen de portada',
      tab: 'settings'
    },
    {
      id: 'bio',
      name: 'Biografía',
      icon: '✏️',
      done: !!(user.bio && user.bio.trim().length >= 20),
      action: 'Cuéntales quién eres',
      tab: 'settings'
    },
    {
      id: 'mercadopago',
      name: 'Mercado Pago',
      icon: '💳',
      done: !!user.mp_user_id,
      action: 'Vincula tu cuenta para cobrar',
      tab: 'settings'
    },
    {
      id: 'plan',
      name: 'Plan de suscripción',
      icon: '💎',
      done: user.has_plan === true,
      action: 'Define cuánto quieres ganar',
      tab: 'plans'
    },
    {
      id: 'first_post',
      name: 'Primer contenido',
      icon: '📷',
      done: (stats.total_posts || 0) > 0,
      action: 'Comparte tu primer contenido',
      tab: 'upload'
    },
    {
      id: 'first_subscriber',
      name: 'Primer suscriptor',
      icon: '⭐',
      done: (stats.total_subscribers || 0) > 0,
      action: 'Comparte tu perfil para conseguir fans',
      tab: 'profile',
      isBonus: true
    }
  ];

  const completedEffective = effectiveSteps.filter((s) => s.done).length;
  const totalEffective = effectiveSteps.length;
  const percent = Math.round((completedEffective / totalEffective) * 100);

  return {
    percent,
    completedEffective,
    totalEffective,
    steps: allSteps,
    allCompleted: allSteps.filter((s) => s.done).length === allSteps.length
  };
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, handle } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'Campos requeridos' });
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(409).json({ error: 'Email ya registrado' });
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const userHandle = handle || '@' + email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g,'');
    console.log('[auth/register] creating user', { id, email, role, handle: userHandle });
    db.prepare('INSERT INTO users (id, name, email, password, role, handle) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, email, hash, role, userHandle);
    // Crear planes demo para creadores
    if (role === 'creator') {
      const plans = [
        { id: uuidv4(), name: 'Basico', price: 5, features: JSON.stringify(['Acceso al feed de fotos','Contenido exclusivo basico','Newsletter mensual']), is_featured: 0 },
        { id: uuidv4(), name: 'Premium', price: 0, features: JSON.stringify(['Todo lo del plan Basico','Acceso a todos los videos','Contenido BTS exclusivo','Descarga de archivos']), is_featured: 1 },
        { id: uuidv4(), name: 'VIP', price: 25, features: JSON.stringify(['Todo lo del plan Premium','Menciones en stories','Acceso anticipado','Contenido personalizado']), is_featured: 0 }
      ];
      const stmt = db.prepare('INSERT INTO plans (id, creator_id, name, price, features, is_featured) VALUES (?,?,?,?,?,?)');
      plans.forEach(p => stmt.run(p.id, id, p.name, p.price, p.features, p.is_featured));
    }
    const token = jwt.sign({ id, name, email, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    console.log('[auth/register] token issued', { id, email, role });
    res.json({ token, user: { id, name, email, role, handle: userHandle } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Credenciales incorrectas' });
    console.log('[auth/login] success', { id: user.id, email: user.email, role: user.role });
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, handle: user.handle, avatar_url: user.avatar_url } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db
    .prepare(
      'SELECT id, name, email, role, handle, bio, category, location, avatar_url, banner_url, avatar_color, social_instagram, social_facebook, social_tiktok, social_other FROM users WHERE id = ?'
    )
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (user.role !== 'creator') {
    return res.json(user);
  }

  const mpRow = db.prepare('SELECT mp_user_id FROM mercado_pago_accounts WHERE user_id = ?').get(user.id);
  const mp_user_id =
    mpRow && mpRow.mp_user_id != null && String(mpRow.mp_user_id).trim() !== ''
      ? String(mpRow.mp_user_id)
      : null;

  const hasPlan = !!db
    .prepare('SELECT 1 FROM plans WHERE creator_id = ? AND active = 1 AND price > 0 LIMIT 1')
    .get(user.id);

  const total_posts = db.prepare('SELECT COUNT(*) AS n FROM content WHERE creator_id = ?').get(user.id).n;
  const total_subscribers = db
    .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE creator_id = ? AND status = 'active'")
    .get(user.id).n;

  const stats = { total_posts, total_subscribers };
  const userForOnboarding = { ...user, mp_user_id, has_plan: hasPlan };
  const onboarding = getOnboardingStatus(userForOnboarding, stats);

  res.json({
    ...user,
    mp_user_id,
    has_plan: hasPlan,
    onboarding
  });
});

router.put('/profile', require('../middleware/auth'), (req, res) => {
  const { handle, bio, category, location, avatar_color, social_instagram, social_facebook, social_tiktok, social_other } =
    req.body;
  const cleanedHandle = (handle || '').trim();
  if (!cleanedHandle || cleanedHandle.length < 3) {
    return res.status(400).json({ error: 'Tu alias debe tener al menos 3 caracteres' });
  }
  const handleCore = cleanedHandle.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._]/g, '');
  if (!handleCore || handleCore.length < 3) {
    return res.status(400).json({ error: 'Usa solo letras, numeros, punto o guion bajo (min 3)' });
  }
  const normalizedHandle = '@' + handleCore;
  const handleTaken = db.prepare('SELECT id FROM users WHERE handle = ? AND id != ?').get(normalizedHandle, req.user.id);
  if (handleTaken) return res.status(409).json({ error: 'Ese alias ya está en uso' });
  const bioStr = typeof bio === 'string' ? bio.slice(0, 200) : '';
  const locStr = typeof location === 'string' ? location.trim().slice(0, 120) : '';
  const s = (v) => (typeof v === 'string' ? v.trim().slice(0, 500) : '');
  db.prepare(
    'UPDATE users SET handle=?, bio=?, category=?, location=?, avatar_color=?, social_instagram=?, social_facebook=?, social_tiktok=?, social_other=? WHERE id=?'
  ).run(
    normalizedHandle,
    bioStr,
    category || '',
    locStr,
    avatar_color || '#333333',
    s(social_instagram),
    s(social_facebook),
    s(social_tiktok),
    s(social_other),
    req.user.id
  );
  res.json({ success: true, handle: normalizedHandle });
});

// Subir foto de perfil
router.post('/avatar', require('../middleware/auth'), upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
  const avatar_url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatar_url, req.user.id);
  res.json({ avatar_url });
});

router.post('/banner', require('../middleware/auth'), upload.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
  const banner_url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET banner_url = ? WHERE id = ?').run(banner_url, req.user.id);
  res.json({ banner_url });
});

module.exports = router;
