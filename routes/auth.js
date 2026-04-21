
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
const { getClientIp } = require('../lib/getClientIp');
const { isReservedUsername } = require('../lib/reservedUsernames');
const { loginRateAllowed, loginRateRecordFailure, loginRateReset } = require('../lib/loginRateLimit');

/** URL pública de la app (enlace en correos de recuperación). Railway: define APP_URL. */
function getPublicAppUrl() {
  const raw = process.env.APP_URL || process.env.PUBLIC_URL;
  if (raw && String(raw).trim()) return String(raw).replace(/\/$/, '');
  return 'https://bizponzor-production.up.railway.app';
}

function normalizeUsername(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return s.slice(0, 30);
}

/** Respuesta /me sin datos sensibles; campos base siempre presentes. */
function buildMePayload(user, extras) {
  const base = {
    id: user.id,
    name: user.name,
    username: user.username != null ? user.username : null,
    email: user.email,
    avatar_url: user.avatar_url || null,
    updated_at: user.updated_at || null,
    role: user.role,
    handle: user.handle || null,
    bio: user.bio || null,
    category: user.category || null,
    location: user.location || null,
    banner_url: user.banner_url || null,
    avatar_color: user.avatar_color || null,
    social_instagram: user.social_instagram || null,
    social_facebook: user.social_facebook || null,
    social_tiktok: user.social_tiktok || null,
    social_other: user.social_other || null,
    ...(user.role === 'creator'
      ? {
          is_public: !(user.is_public === false || user.is_public === 0 || user.is_public === '0')
        }
      : {})
  };
  return extras && typeof extras === 'object' ? { ...base, ...extras } : base;
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
    if (isReservedUsername(username)) {
      return res.status(400).json({ error: 'Username no disponible' });
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

    if (await db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim().toLowerCase())) {
      return res.status(409).json({ error: 'Email ya registrado' });
    }
    if (await db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const id = uuidv4();
    const userHandle = handle && String(handle).trim() ? String(handle).trim() : '@' + username;

    const handleTaken = await db.prepare('SELECT id FROM users WHERE handle = ?').get(userHandle);
    if (handleTaken) {
      return res.status(409).json({ error: 'No se pudo asignar el alias; prueba otro usuario' });
    }

    const now = new Date().toISOString();
    const clientIp = getClientIp(req);

    console.log('[auth/register] creating user', { id, email, role, username, handle: userHandle });
    await db
      .prepare(
        `INSERT INTO users (
        id, name, email, password, role, handle,
        username,
        terms_accepted_at, privacy_accepted_at, terms_version, privacy_version, accepted_ip,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
      id,
      String(name).trim().slice(0, 120),
      String(email).trim().toLowerCase(),
      hashedPassword,
      role,
      userHandle,
      username,
      now,
      now,
      TERMS_VERSION,
      PRIVACY_VERSION,
      clientIp || null
    );

    if (role === 'creator') {
      const plans = [
        { id: uuidv4(), name: 'Basico', price: 5, features: JSON.stringify(['Acceso al feed de fotos','Contenido exclusivo basico','Newsletter mensual']), is_featured: 0 },
        { id: uuidv4(), name: 'Premium', price: 0, features: JSON.stringify(['Todo lo del plan Basico','Acceso a todos los videos','Contenido BTS exclusivo','Descarga de archivos']), is_featured: 1 },
        { id: uuidv4(), name: 'VIP', price: 25, features: JSON.stringify(['Todo lo del plan Premium','Menciones en stories','Acceso anticipado','Contenido personalizado']), is_featured: 0 }
      ];
      const stmt = db.prepare('INSERT INTO plans (id, creator_id, name, price, features, is_featured) VALUES (?,?,?,?,?,?)');
      for (let i = 0; i < plans.length; i++) {
        const p = plans[i];
        await stmt.run(p.id, id, p.name, p.price, p.features, p.is_featured);
      }
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
    const ip = getClientIp(req) || 'unknown';
    if (!loginRateAllowed(ip)) {
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
    }

    const { email, password } = req.body;
    const normalized = String(email || '').trim().toLowerCase();
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
    const ok = user && (await bcrypt.compare(String(password || ''), user.password));
    if (!ok) {
      loginRateRecordFailure(ip);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    loginRateReset(ip);

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
        avatar_url: user.avatar_url,
        updated_at: user.updated_at || null
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '')
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Correo requerido' });
    }
    const user = await db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresMs = Date.now() + 3600000;
    const expiresIso = new Date(expiresMs).toISOString();

    if (user) {
      await db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expiresIso, user.id);

      const apiKey = process.env.RESEND_API_KEY;
      if (apiKey) {
        try {
          const { Resend } = require('resend');
          const resend = new Resend(apiKey);
          const base = getPublicAppUrl();
          const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`;
          const resendFrom =
            (process.env.RESEND_FROM && String(process.env.RESEND_FROM).trim()) ||
            'Bizponzor <soporte@bizponzor.com>';
          const sendResult = await resend.emails.send({
            from: resendFrom,
            to: user.email,
            subject: 'Restablece tu contraseña — BizPonzor',
            html: `<p>Hola,</p><p>Para restablecer tu contraseña, usa este enlace (válido 1 hora):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Si no solicitaste esto, ignora este mensaje.</p>`
          });
          console.log('[auth/forgot-password] Resend full response:', JSON.stringify(sendResult, null, 2));
        } catch (sendErr) {
          console.error('[auth/forgot-password] Resend exception:', sendErr && sendErr.message, sendErr);
        }
      } else {
        console.warn('[auth/forgot-password] RESEND_API_KEY no configurado; correo no enviado');
        if (process.env.NODE_ENV !== 'production') {
          console.log('[auth/forgot-password] Reset token (solo sin Resend / no-producción):', token);
        }
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
    const row = await db.prepare('SELECT id, reset_token_expires FROM users WHERE reset_token = ?').get(String(token));
    if (!row) {
      return res.status(400).json({ error: 'Enlace inválido o expirado' });
    }
    const exp = row.reset_token_expires ? new Date(row.reset_token_expires).getTime() : 0;
    if (!exp || Date.now() > exp) {
      return res.status(400).json({ error: 'El enlace expiró. Solicita uno nuevo.' });
    }
    const hashedPassword = await bcrypt.hash(String(password), 10);
    await db
      .prepare(
        'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL, updated_at = datetime(\'now\') WHERE id = ?'
      )
      .run(hashedPassword, row.id);
    res.json({ success: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (e) {
    console.error('[auth/reset-password]', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/me', require('../middleware/auth'), async (req, res) => {
  const user = await db
    .prepare(
      'SELECT id, name, email, role, handle, username, bio, category, location, avatar_url, banner_url, avatar_color, social_instagram, social_facebook, social_tiktok, social_other, updated_at, is_public FROM users WHERE id = ?'
    )
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (user.role !== 'creator') {
    return res.json(buildMePayload(user));
  }

  const mpRow = await db.prepare('SELECT mp_user_id FROM mercado_pago_accounts WHERE user_id = ?').get(user.id);
  const mp_user_id =
    mpRow && mpRow.mp_user_id != null && String(mpRow.mp_user_id).trim() !== ''
      ? String(mpRow.mp_user_id)
      : null;

  const hasPlan = !!(await db
    .prepare('SELECT 1 FROM plans WHERE creator_id = ? AND active = 1 AND price > 0 LIMIT 1')
    .get(user.id));

  const postsRow = await db.prepare('SELECT COUNT(*) AS n FROM content WHERE creator_id = ?').get(user.id);
  const total_posts = Number(postsRow?.n ?? 0);
  const subsRow = await db
    .prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE creator_id = ? AND status = 'active'")
    .get(user.id);
  const total_subscribers = Number(subsRow?.n ?? 0);

  const stats = { total_posts, total_subscribers };
  const userForOnboarding = { ...user, mp_user_id, has_plan: hasPlan };
  const onboarding = getOnboardingStatus(userForOnboarding, stats);

  res.json(
    buildMePayload(user, {
      mp_user_id,
      has_plan: hasPlan,
      onboarding
    })
  );
});

router.put('/profile', require('../middleware/auth'), async (req, res) => {
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
  const handleTaken = await db.prepare('SELECT id FROM users WHERE handle = ? AND id != ?').get(normalizedHandle, req.user.id);
  if (handleTaken) return res.status(409).json({ error: 'Ese alias ya está en uso' });
  const bioStr = typeof bio === 'string' ? bio.slice(0, 200) : '';
  const locStr = typeof location === 'string' ? location.trim().slice(0, 120) : '';
  const s = (v) => (typeof v === 'string' ? v.trim().slice(0, 500) : '');
  await db
    .prepare(
      'UPDATE users SET handle=?, bio=?, category=?, location=?, avatar_color=?, social_instagram=?, social_facebook=?, social_tiktok=?, social_other=? WHERE id=?'
    )
    .run(
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

router.post('/banner', require('../middleware/auth'), uploadBanner.single('banner'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
  const banner_url = '/uploads/' + req.file.filename;
  await db.prepare('UPDATE users SET banner_url = ? WHERE id = ?').run(banner_url, req.user.id);
  res.json({ banner_url });
});

module.exports = router;
