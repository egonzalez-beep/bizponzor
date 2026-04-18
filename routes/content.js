
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const { createNotification, fireAndForget } = require('../lib/createNotification');

async function notifyFansNewContent(creatorId, contentId, previewText) {
  const creator = await db.prepare('SELECT id, name, handle FROM users WHERE id = ?').get(creatorId);
  if (!creator) return;
  const fans = await db
    .prepare(`SELECT fan_id FROM subscriptions WHERE creator_id = ? AND status = 'active'`)
    .all(creatorId);
  const preview =
    previewText && String(previewText).trim()
      ? String(previewText).trim().slice(0, 200)
      : 'Nuevo contenido';
  const metadata = {
    creatorId,
    creatorName: creator.name || 'Creador',
    creatorHandle: creator.handle ? String(creator.handle).trim() : '',
    contentId,
    previewText: preview
  };
  for (let i = 0; i < fans.length; i++) {
    const fid = fans[i].fan_id;
    if (!fid) continue;
    fireAndForget(
      createNotification({
        userId: fid,
        type: 'NEW_CONTENT_FROM_CREATOR',
        metadata,
        dedupeKey: `fan-new-content-${contentId}-${fid}`
      })
    );
  }
}

const uploadsDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

function requireCreator(req, res, next) {
  if (!req.user || req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  next();
}

async function ensureAuthedUserInDb(req, res, next) {
  const userId = req.user?.id;
  const email = req.user?.email;
  const name = req.user?.name || 'Usuario';
  const role = req.user?.role;

  const userExists = await db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(userId);
  if (userExists) return next();

  console.warn('[content/upload] FK guard: user id not found in DB, attempting repair', { userId, email, role });

  // If there's already a user with this email but different id, we cannot safely repair.
  if (email) {
    const byEmail = await db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
    if (byEmail && byEmail.id !== userId) {
      console.error('[content/upload] repair blocked: email belongs to another user id', { tokenUserId: userId, dbUserId: byEmail.id, email });
      return res.status(400).json({ error: 'Usuario creador no encontrado en la base de datos (token desincronizado). Cierra sesión e inicia sesión nuevamente.' });
    }
  }

  // Minimal "repair" insert to satisfy FK constraints.
  // NOTE: password is required by schema; this record is not meant for password login.
  const safeHandle = email ? ('@' + email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')) : ('@user' + String(userId || '').slice(0, 6));
  const passwordPlaceholder = 'TOKEN_ONLY_' + uuidv4();

  try {
    await db
      .prepare('INSERT INTO users (id, name, email, password, role, handle) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        userId,
        name,
        email || (userId + '@token.local'),
        passwordPlaceholder,
        role || 'creator',
        safeHandle
      );
    console.warn('[content/upload] repair insert ok', { userId });
    next();
  } catch (e) {
    console.error('[content/upload] repair insert failed', { userId, email, role, err: e.message });
    return res.status(400).json({ error: 'Usuario creador no encontrado en la base de datos' });
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const TEXT_BACKGROUND_STYLES = new Set([
  'galaxy',
  'blue_basic',
  'red_passion',
  'mint_green',
  'yellow_sun',
  'minimal_gold',
  'cyberpunk'
]);

function normalizeTextBackgroundStyle(raw) {
  const k = raw != null ? String(raw).trim() : '';
  return TEXT_BACKGROUND_STYLES.has(k) ? k : 'galaxy';
}

/**
 * Resuelve programación: fecha futura → scheduled; pasada o sin fecha → published.
 * El cliente debe enviar ISO 8601 en UTC (p. ej. desde datetime-local vía toISOString());
 * si se parsea sin zona en el servidor, se interpreta en la TZ del proceso (p. ej. UTC) y la hora se desplaza.
 * @returns {{ status: string, scheduledFor: string|null, error?: string }}
 */
function resolveSchedule(scheduled_for) {
  let status = 'published';
  let scheduledFor = null;
  const raw =
    scheduled_for != null && scheduled_for !== undefined ? String(scheduled_for).trim() : '';
  if (!raw) {
    return { status, scheduledFor };
  }
  const scheduledDate = new Date(raw);
  const now = new Date();
  const maxFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (isNaN(scheduledDate.getTime())) {
    return { status, scheduledFor, error: 'Fecha inválida' };
  }
  if (scheduledDate > maxFuture) {
    return {
      status,
      scheduledFor,
      error: 'No se puede programar más de 30 días en el futuro'
    };
  }
  if (scheduledDate > now) {
    status = 'scheduled';
    scheduledFor = scheduledDate.toISOString();
  }
  return { status, scheduledFor };
}

function uploadSingleFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Archivo demasiado grande (max 50MB)' });
      }
      return res.status(400).json({ error: 'Error al procesar archivo', detail: err.message });
    }
    next();
  });
}

router.post('/text', authMiddleware, requireCreator, ensureAuthedUserInDb, async (req, res) => {
  try {
    const { title, description, text_body, is_exclusive, scheduled_for, background_style } = req.body;
    const body = String(text_body || '').trim();
    if (!body) return res.status(400).json({ error: 'El texto es obligatorio' });
    const bgStyle = normalizeTextBackgroundStyle(background_style);
    const userExists = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
    if (!userExists) return res.status(400).json({ error: 'Usuario no encontrado' });

    const sched = resolveSchedule(scheduled_for);
    if (sched.error) {
      return res.status(400).json({ error: sched.error });
    }
    const { status, scheduledFor } = sched;

    const id = uuidv4();
    const file_url = 'text://' + id;
    const excl = is_exclusive === false || is_exclusive === 'false' ? 0 : 1;
    await db
      .prepare(
        `INSERT INTO content (id, creator_id, title, description, type, file_url, is_exclusive, text_body, background_style, scheduled_for, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
      id,
      req.user.id,
      title || 'Publicación',
      description || '',
      'text',
      file_url,
      excl,
      body,
      bgStyle,
      scheduledFor,
      status
    );
    if (status === 'published') {
      const short = body.length > 80 ? body.slice(0, 77) + '...' : body;
      const label = (title && String(title).trim()) || short;
      createNotification({
        userId: req.user.id,
        type: 'NEW_CONTENT',
        metadata: { contentId: id, contentLabel: label },
        dedupeKey: `content-publish-${id}`
      }).catch(() => null);
      notifyFansNewContent(req.user.id, id, label).catch(() => null);
    }
    console.log('[POST] Creado:', {
      id,
      title: title || 'Publicación',
      status,
      scheduled_for: scheduledFor
    });
    res.json({
      id,
      title: title || 'Publicación',
      type: 'text',
      is_exclusive: !!excl,
      status,
      scheduled_for: scheduledFor,
      background_style: bgStyle
    });
  } catch (e) {
    console.error('[content/text]', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/upload', authMiddleware, requireCreator, ensureAuthedUserInDb, (req, res, next) => {
  console.log('[content/upload] Incoming request', {
    contentType: req.headers['content-type'],
    authHeader: !!req.headers.authorization
  });
  next();
}, uploadSingleFile, async (req, res) => {
  try {
    console.log('[content/upload] Parsed payload', {
      bodyKeys: Object.keys(req.body || {}),
      hasFile: !!req.file,
      fileField: req.file?.fieldname,
      originalName: req.file?.originalname,
      savedAs: req.file?.filename
    });
    const userExists = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
    if (!userExists) return res.status(400).json({ error: 'Usuario creador no encontrado en la base de datos' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const { title, description, is_exclusive, scheduled_for } = req.body;
    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    const sched = resolveSchedule(scheduled_for);
    if (sched.error) {
      return res.status(400).json({ error: sched.error });
    }
    const { status, scheduledFor } = sched;

    const ext = path.extname(req.file.filename).toLowerCase();
    const type = ['.mp4','.mov','.avi','.mkv','.webm'].includes(ext) ? 'video' : 'photo';
    const file_url = '/uploads/' + req.file.filename;
    const id = uuidv4();
    await db
      .prepare(
        `INSERT INTO content (id, creator_id, title, description, type, file_url, is_exclusive, scheduled_for, status)
       VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
      id,
      req.user.id,
      cleanTitle,
      description || '',
      type,
      file_url,
      is_exclusive === 'true' ? 1 : 0,
      scheduledFor,
      status
    );
    if (status === 'published') {
      const label = cleanTitle || (type === 'video' ? 'Nuevo video' : 'Nueva foto');
      createNotification({
        userId: req.user.id,
        type: 'NEW_CONTENT',
        metadata: { contentId: id, contentLabel: label },
        dedupeKey: `content-publish-${id}`
      }).catch(() => null);
      notifyFansNewContent(req.user.id, id, label).catch(() => null);
    }
    console.log('[POST] Creado:', {
      id,
      title: cleanTitle || '(sin título)',
      status,
      scheduled_for: scheduledFor
    });
    res.json({
      id,
      title: cleanTitle,
      type,
      file_url,
      is_exclusive: is_exclusive === 'true',
      status,
      scheduled_for: scheduledFor
    });
  } catch (e) {
    console.error('[content/upload] Handler error:', e);
    res.status(500).json({ error: e.message });
  }
});

async function sendCreatorPublicFeed(req, res) {
  const { creatorId } = req.params;
  let userId = null;
  try {
    const jwt = require('jsonwebtoken');
    const token = req.headers.authorization?.split(' ')[1];
    if (token) userId = jwt.verify(token, process.env.JWT_SECRET).id;
  } catch {}
  const allContent = await db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM stars WHERE content_id = c.id) as stars_count,
        EXISTS(SELECT 1 FROM stars WHERE content_id = c.id AND user_id = ?) as starred
       FROM content c
       WHERE c.creator_id = ? AND (c.status IS NULL OR c.status = 'published')
       ORDER BY c.created_at DESC`
    )
    .all(userId || '', creatorId);
  let hasAccess = userId === creatorId;
  if (!hasAccess && userId) {
    const sub = await db
      .prepare(
        "SELECT id FROM subscriptions WHERE fan_id=? AND creator_id=? AND status='active'"
      )
      .get(userId, creatorId);
    hasAccess = !!sub;
  }
  res.json(
    allContent.map((c) => {
      const locked = !!(c.is_exclusive && !hasAccess);
      if (c.type === 'text') {
        return {
          ...c,
          file_url: locked ? null : c.file_url,
          text_body: locked ? null : (c.text_body || ''),
          locked
        };
      }
      return {
        ...c,
        file_url: locked ? null : null,
        text_body: null,
        locked
      };
    })
  );
}

/** Misma respuesta que /feed/:creatorId */
router.get('/creator/:creatorId', (req, res, next) => {
  sendCreatorPublicFeed(req, res).catch(next);
});
router.get('/feed/:creatorId', (req, res, next) => {
  sendCreatorPublicFeed(req, res).catch(next);
});

router.get('/my', authMiddleware, requireCreator, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT c.*,
          (SELECT COUNT(*) FROM stars WHERE content_id = c.id) as stars_count,
          EXISTS(SELECT 1 FROM stars WHERE content_id = c.id AND user_id = ?) as starred
         FROM content c
         WHERE c.creator_id = ? AND (c.status IS NULL OR c.status IN ('published','scheduled'))
         ORDER BY
           CASE c.status
             WHEN 'scheduled' THEN 1
             WHEN 'published' THEN 2
             ELSE 3
           END,
           c.scheduled_for ASC,
           c.created_at DESC`
    )
    .all(req.user.id, req.user.id);
  res.json(rows);
});

/**
 * Clave YYYY-MM-DD para el calendario. node-pg devuelve DATE como Date;
 * si se usa como clave de objeto, JSON.stringify envía strings ilegibles y el front no coincide.
 */
function scheduledSummaryDayKey(day) {
  if (day == null || day === '') return null;
  if (typeof day === 'string') {
    const s = day.trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return (
        d.getUTCFullYear() +
        '-' +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        '-' +
        String(d.getUTCDate()).padStart(2, '0')
      );
    }
    return null;
  }
  if (Object.prototype.toString.call(day) === '[object Date]' && !isNaN(day.getTime())) {
    return (
      day.getUTCFullYear() +
      '-' +
      String(day.getUTCMonth() + 1).padStart(2, '0') +
      '-' +
      String(day.getUTCDate()).padStart(2, '0')
    );
  }
  return null;
}

router.get('/scheduled-summary', authMiddleware, requireCreator, async (req, res) => {
  const userId = req.user.id;

  const rows = await db
    .prepare(
      `SELECT
        DATE(scheduled_for) AS day,
        COUNT(*) AS total
      FROM content
      WHERE creator_id = ?
        AND status = 'scheduled'
        AND scheduled_for IS NOT NULL
      GROUP BY DATE(scheduled_for)`
    )
    .all(userId);

  const summary = {};
  rows.forEach((r) => {
    const key = scheduledSummaryDayKey(r.day);
    if (!key) return;
    const n = Number(r.total) || 0;
    summary[key] = (summary[key] || 0) + n;
  });

  res.json(summary);
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const c = await db.prepare('SELECT * FROM content WHERE id=? AND creator_id=?').get(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  await db.prepare('DELETE FROM content WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
