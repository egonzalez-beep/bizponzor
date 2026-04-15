
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const uploadsDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

function requireCreator(req, res, next) {
  if (!req.user || req.user.role !== 'creator') {
    return res.status(403).json({ error: 'Solo creadores' });
  }
  next();
}

function ensureAuthedUserInDb(req, res, next) {
  const userId = req.user?.id;
  const email = req.user?.email;
  const name = req.user?.name || 'Usuario';
  const role = req.user?.role;

  const userExists = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(userId);
  if (userExists) return next();

  console.warn('[content/upload] FK guard: user id not found in DB, attempting repair', { userId, email, role });

  // If there's already a user with this email but different id, we cannot safely repair.
  if (email) {
    const byEmail = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);
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
    db.prepare('INSERT INTO users (id, name, email, password, role, handle) VALUES (?, ?, ?, ?, ?, ?)')
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

/**
 * Resuelve programación: fecha futura → scheduled; pasada o sin fecha → published.
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
  const scheduledDate =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)
      ? new Date(raw + ':00')
      : new Date(raw);
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

router.post('/text', authMiddleware, requireCreator, ensureAuthedUserInDb, (req, res) => {
  try {
    const { title, description, text_body, is_exclusive, scheduled_for } = req.body;
    const body = String(text_body || '').trim();
    if (!body) return res.status(400).json({ error: 'El texto es obligatorio' });
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
    if (!userExists) return res.status(400).json({ error: 'Usuario no encontrado' });

    const sched = resolveSchedule(scheduled_for);
    if (sched.error) {
      return res.status(400).json({ error: sched.error });
    }
    const { status, scheduledFor } = sched;

    const id = uuidv4();
    const file_url = 'text://' + id;
    const excl = is_exclusive === false || is_exclusive === 'false' ? 0 : 1;
    db.prepare(
      `INSERT INTO content (id, creator_id, title, description, type, file_url, is_exclusive, text_body, scheduled_for, status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      req.user.id,
      title || 'Publicación',
      description || '',
      'text',
      file_url,
      excl,
      body,
      scheduledFor,
      status
    );
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
      scheduled_for: scheduledFor
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
}, uploadSingleFile, (req, res) => {
  try {
    console.log('[content/upload] Parsed payload', {
      bodyKeys: Object.keys(req.body || {}),
      hasFile: !!req.file,
      fileField: req.file?.fieldname,
      originalName: req.file?.originalname,
      savedAs: req.file?.filename
    });
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
    if (!userExists) return res.status(400).json({ error: 'Usuario creador no encontrado en la base de datos' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const { title, description, is_exclusive, scheduled_for } = req.body;
    const sched = resolveSchedule(scheduled_for);
    if (sched.error) {
      return res.status(400).json({ error: sched.error });
    }
    const { status, scheduledFor } = sched;

    const ext = path.extname(req.file.filename).toLowerCase();
    const type = ['.mp4','.mov','.avi','.mkv','.webm'].includes(ext) ? 'video' : 'photo';
    const file_url = '/uploads/' + req.file.filename;
    const id = uuidv4();
    db.prepare(
      `INSERT INTO content (id, creator_id, title, description, type, file_url, is_exclusive, scheduled_for, status)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      req.user.id,
      title || 'Sin titulo',
      description || '',
      type,
      file_url,
      is_exclusive === 'true' ? 1 : 0,
      scheduledFor,
      status
    );
    console.log('[POST] Creado:', {
      id,
      title: title || 'Sin titulo',
      status,
      scheduled_for: scheduledFor
    });
    res.json({
      id,
      title,
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

function sendCreatorPublicFeed(req, res) {
  const { creatorId } = req.params;
  let userId = null;
  try {
    const jwt = require('jsonwebtoken');
    const token = req.headers.authorization?.split(' ')[1];
    if (token) userId = jwt.verify(token, process.env.JWT_SECRET).id;
  } catch {}
  const allContent = db
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
    const sub = db
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
        file_url: locked ? null : c.file_url,
        text_body: null,
        locked
      };
    })
  );
}

/** Misma respuesta que /feed/:creatorId */
router.get('/creator/:creatorId', sendCreatorPublicFeed);
router.get('/feed/:creatorId', sendCreatorPublicFeed);

router.get('/my', authMiddleware, requireCreator, (req, res) => {
  res.json(
    db
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
      .all(req.user.id, req.user.id)
  );
});

router.get('/scheduled-summary', authMiddleware, requireCreator, (req, res) => {
  const userId = req.user.id;

  const rows = db
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
    summary[r.day] = r.total;
  });

  res.json(summary);
});

router.delete('/:id', authMiddleware, (req, res) => {
  const c = db.prepare('SELECT * FROM content WHERE id=? AND creator_id=?').get(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM content WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
