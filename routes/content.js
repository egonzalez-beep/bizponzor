
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
    const { title, description, text_body, is_exclusive } = req.body;
    const body = String(text_body || '').trim();
    if (!body) return res.status(400).json({ error: 'El texto es obligatorio' });
    const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(req.user.id);
    if (!userExists) return res.status(400).json({ error: 'Usuario no encontrado' });
    const id = uuidv4();
    const file_url = 'text://' + id;
    const excl = is_exclusive === false || is_exclusive === 'false' ? 0 : 1;
    db.prepare(
      `INSERT INTO content (id, creator_id, title, description, type, file_url, is_exclusive, text_body)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      id,
      req.user.id,
      title || 'Publicación',
      description || '',
      'text',
      file_url,
      excl,
      body
    );
    res.json({ id, title: title || 'Publicación', type: 'text', is_exclusive: !!excl });
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
    const { title, description, is_exclusive } = req.body;
    const ext = path.extname(req.file.filename).toLowerCase();
    const type = ['.mp4','.mov','.avi','.mkv','.webm'].includes(ext) ? 'video' : 'photo';
    const file_url = '/uploads/' + req.file.filename;
    const id = uuidv4();
    db.prepare('INSERT INTO content (id, creator_id, title, description, type, file_url, is_exclusive) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.user.id, title || 'Sin titulo', description || '', type, file_url, is_exclusive === 'true' ? 1 : 0);
    res.json({ id, title, type, file_url, is_exclusive: is_exclusive === 'true' });
  } catch (e) {
    console.error('[content/upload] Handler error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/feed/:creatorId', (req, res) => {
  const { creatorId } = req.params;
  let userId = null;
  try {
    const jwt = require('jsonwebtoken');
    const token = req.headers.authorization?.split(' ')[1];
    if (token) userId = jwt.verify(token, process.env.JWT_SECRET).id;
  } catch {}
  const allContent = db
    .prepare('SELECT * FROM content WHERE creator_id = ? ORDER BY created_at DESC')
    .all(creatorId);
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
});

router.get('/my', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT * FROM content WHERE creator_id = ? ORDER BY created_at DESC').all(req.user.id));
});

router.delete('/:id', authMiddleware, (req, res) => {
  const c = db.prepare('SELECT * FROM content WHERE id=? AND creator_id=?').get(req.params.id, req.user.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM content WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
