const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');

const uploadsDir = path.join(__dirname, '..', 'uploads');

function unlinkOldAvatar(relativeUrl) {
  if (!relativeUrl || typeof relativeUrl !== 'string') return;
  if (!relativeUrl.startsWith('/uploads/')) return;
  const base = path.basename(relativeUrl);
  if (!base || base.includes('..') || base.includes('/') || base.includes('\\')) return;
  const full = path.join(uploadsDir, base);
  fs.unlink(full, () => {});
}

/**
 * El cliente redimensiona a 512×512 (Canvas); aquí solo validamos y guardamos (misma carpeta /uploads que el banner).
 * POST /api/auth/avatar y PATCH /api/users/avatar (mismo handler).
 */
async function handleAvatarUpload(req, res) {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'Archivo requerido' });
  }

  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(req.file.mimetype)) {
    return res.status(400).json({ error: 'Solo se permiten JPEG, PNG o WebP' });
  }

  fs.mkdirSync(uploadsDir, { recursive: true });

  const row = await db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(req.user.id);
  const previous = row && row.avatar_url;

  const ext = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const filename = `${crypto.randomUUID()}.${ext}`;
  const outPath = path.join(uploadsDir, filename);

  try {
    fs.writeFileSync(outPath, req.file.buffer);
  } catch (e) {
    console.error('[avatar] write', e);
    return res.status(500).json({ error: 'No se pudo guardar la imagen' });
  }

  const relativeUrl = '/uploads/' + filename;

  await db.prepare(`UPDATE users SET avatar_url = ?, updated_at = datetime('now') WHERE id = ?`).run(relativeUrl, req.user.id);

  if (previous && previous !== relativeUrl) {
    unlinkOldAvatar(previous);
  }

  const u = await db.prepare('SELECT avatar_url, updated_at FROM users WHERE id = ?').get(req.user.id);

  res.json({
    avatarUrl: u.avatar_url,
    avatar_url: u.avatar_url,
    updated_at: u.updated_at
  });
}

module.exports = { handleAvatarUpload, uploadsDir };
