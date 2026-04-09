
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 4 * 1024 * 1024 * 1024 } });

router.post('/upload', authMiddleware, upload.single('file'), (req, res) => {
  try {
    if (req.user.role !== 'creator') return res.status(403).json({ error: 'Solo creadores' });
    if (!req.file) return res.status(400).json({ error: 'Archivo requerido' });
    const { title, description, is_exclusive } = req.body;
    const ext = path.extname(req.file.filename).toLowerCase();
    const type = ['.mp4','.mov','.avi','.mkv','.webm'].includes(ext) ? 'video' : 'photo';
    const file_url = '/uploads/' + req.file.filename;
    const id = uuidv4();
    db.prepare('INSERT INTO content (id, creator_id, title, description, type, file_url, is_exclusive) VALUES (?,?,?,?,?,?,?)')
      .run(id, req.user.id, title || 'Sin titulo', description || '', type, file_url, is_exclusive === 'true' ? 1 : 0);
    res.json({ id, title, type, file_url, is_exclusive: is_exclusive === 'true' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/feed/:creatorId', (req, res) => {
  const { creatorId } = req.params;
  let userId = null;
  try {
    const jwt = require('jsonwebtoken');
    const token = req.headers.authorization?.split(' ')[1];
    if (token) userId = jwt.verify(token, process.env.JWT_SECRET).id;
  } catch {}
  const allContent = db.prepare('SELECT * FROM content WHERE creator_id = ? ORDER BY created_at DESC').all(creatorId);
  let hasAccess = userId === creatorId;
  if (!hasAccess && userId) {
    const sub = db.prepare("SELECT id FROM subscriptions WHERE fan_id=? AND creator_id=? AND status='active'").get(userId, creatorId);
    hasAccess = !!sub;
  }
  res.json(allContent.map(c => ({ ...c, file_url: (c.is_exclusive && !hasAccess) ? null : c.file_url, locked: !!(c.is_exclusive && !hasAccess) })));
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
