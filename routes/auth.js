
const router = require('express').Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../db');
const { avatarMulter } = require('../lib/avatarUpload');
const { handleAvatarUpload } = require('../lib/handleAvatarUpload');
const { TERMS_VERSION, PRIVACY_VERSION, SKIP_LEGAL } = require('../lib/authConfig');

function normalizeUsername(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return s.slice(0, 30);
}

function clientIp(req) {
  const x = req.headers['x-forwarded-for'];
  if (typeof x === 'string' && x.trim()) return x.split(',')[0].trim().slice(0, 64);
  if (req.ip) return String(req.ip).slice(0, 64);
  if (req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress).slice(0, 64);
  return '';
}

const uploadsDir = path.join(__dirname, '../uploads');
const uploadBanner = multer({
  dest: uploadsDir,
  limits: { fileSize: 15 * 1024 * 1024 }
});

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
    const {
      name,
      username: usernameRaw,
      email,
      password,
      passwordConfirm,
      role,
      handle,
      termsAccepted,
      privacyAccepted
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Campos requeridos' });
    }
    const username = normalizeUsername(usernameRaw);
    if (username.length < 3) {
      return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres (letras, números o _)' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (passwordConfirm != null && String(password) !== String(passwordConfirm)) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }
    if (!SKIP_LEGAL) {
      if (!termsAccepted || !privacyAccepted) {
        return res.status(400).json({ error: 'Debes aceptar términos y privacidad' });
      }
    }
    if (!['creator', 'fan'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim().toLowerCase())) {
      return res.status(409).json({ error: 'Email ya registrado' });
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const id = uuidv4();
    const userHandle = handle && String(handle).trim() ? String(handle).trim() : '@' + username;

    const handleTaken = db.prepare('SELECT id FROM users WHERE handle = ?').get(userHandle);
    if (handleTaken) {
      return res.status(409).json({ error: 'No se pudo asignar el alias; prueba otro usuario' });
    }

    const now = new Date().toISOString();
    const ip = clientIp(req);

    console.log('[auth/register] creating user', { id, email, role, username, handle: userHandle });
    db.prepare(
      `INSERT INTO users (
        id, name, email, password, role, handle,
        username,
        terms_accepted_at, privacy_accepted_at, terms_version, privacy_version, accepted_ip,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      id,
      String(name).trim().slice(0, 120),
      String(email).trim().toLowerCase(),
      hash,
      role,
      userHandle,
      username,
      now,
      now,
      TERMS_VERSION,
      PRIVACY_VERSION,
      ip || null
    );

    if (role === 'creator') {
      const plans = [
        { id: uuidv4(), name: 'Basico', price: 5, features: JSON.stringify(['Acceso al feed de fotos','Contenido exclusivo basico','Newsletter mensual']), is_featured: 0 },
        { id: uuidv4(), name: 'Premium', price: 0, features: JSON.stringify(['Todo lo del plan Basico','Acceso a todos los videos','Contenido BTS exclusivo','Descarga de archivos']), is_featured: 1 },
        { id: uuidv4(), name: 'VIP', price: 25, features: JSON.stringify(['Todo lo del plan Premium','Menciones en stories','Acceso anticipado','Contenido personalizado']), is_featured: 0 }
      ];
      const stmt = db.prepare('INSERT INTO plans (id, creator_id, name, price, features, is_featured) VALUES (?,?,?,?,?,?)');
      plans.forEach((p) => stmt.run(p.id, id, p.name, p.price, p.features, p.is_featured));
    }
    const emailNorm = String(email).trim().toLowerCase();
    const nameTrim = String(name).trim().slice(0, 120);
    const token = jwt.sign({ id, name: nameTrim, email: emailNorm, role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    console.log('[auth/register] token issued', { id, email, role, username });
    res.json({
      token,
      user: { id, name: nameTrim, email: emailNorm, role, handle: userHandle, username }
    });
  } catch (e) {
    console.error('[auth/register]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalized = String(email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
    if (!user || !(await bcrypt.compare(String(password || ''), user.password))) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }
    console.log('[auth/login] success', { id: user.id, email: user.email, role: user.role });
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        handle: user.handle,
        username: user.username || null,
        avatar_url: user.avatar_url
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/forgot-password', (req, res) => {
  try {
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Correo requerido' });
    }
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresMs = Date.now() + 3600000;
    const expiresIso = new Date(expiresMs).toISOString();

    if (user) {
      db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expiresIso, user.id);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[auth/forgot-password] dev token for', email, '→', token);
      }
    }
    res.json({
      message: 'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.'
    });
  } catch (e) {
    console.error('[auth/forgot-password]', e);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password, passwordConfirm } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'Token y contraseña requeridos' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }
    if (passwordConfirm != null && String(password) !== String(passwordConfirm)) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' });
    }
    const row = db.prepare('SELECT id, reset_token_expires FROM users WHERE reset_token = ?').get(String(token));
    if (!row) {
      return res.status(400).json({ error: 'Enlace inválido o expirado' });
    }
    const exp = row.reset_token_expires ? new Date(row.reset_token_expires).getTime() : 0;
    if (!exp || Date.now() > exp) {
      return res.status(400).json({ error: 'El enlace expiró. Solicita uno nuevo.' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    db.prepare(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = datetime(\'now\') WHERE id = ?'
    ).run(hash, row.id);
    res.json({ success: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (e) {
    console.error('[auth/reset-password]', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', require('../middleware/auth'), (req, res) => {
  const user = db
    .prepare(
      'SELECT id, name, email, role, handle, username, bio, category, location, avatar_url, banner_url, avatar_color, social_instagram, social_facebook, social_tiktok, social_other, updated_at FROM users WHERE id = ?'
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

// Subir foto de perfil (misma lógica que PATCH /api/users/avatar)
router.post('/avatar', require('../middleware/auth'), (req, res, next) => {
  avatarMulter.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo supera 2 MB' });
      return res.status(400).json({ error: String(err.message || 'Archivo inválido') });
    }
    Promise.resolve(handleAvatarUpload(req, res)).catch(next);
  });
});

router.post('/banner', require('../middleware/auth'), uploadBanner.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
  const banner_url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET banner_url = ? WHERE id = ?').run(banner_url, req.user.id);
  res.json({ banner_url });
});

module.exports = router;
