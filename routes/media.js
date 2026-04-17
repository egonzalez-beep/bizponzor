const path = require('path');
const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const uploadsRoot = path.join(__dirname, '..', 'uploads');

function getUserFromReq(req) {
  let token = req.headers.authorization?.split(' ')[1];
  if (!token && req.query.token) token = String(req.query.token);
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function resolveSafeFile(absPath) {
  const resolved = path.resolve(absPath);
  const root = path.resolve(uploadsRoot);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

/**
 * GET /api/media/:contentId?token= (opcional si contenido público)
 * Sirve el archivo con validación de acceso (exclusivo = suscripción activa o dueño).
 */
router.get('/:contentId', (req, res) => {
  const contentId = req.params.contentId;
  const content = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId);
  if (!content) {
    return res.status(404).json({ error: 'No encontrado' });
  }

  if (content.type === 'text' || (content.file_url && String(content.file_url).startsWith('text://'))) {
    return res.status(404).json({ error: 'Sin archivo' });
  }

  const user = getUserFromReq(req);
  const userId = user?.id || null;
  const role = user?.role || null;

  const isOwner = userId && userId === content.creator_id;

  if (!isOwner) {
    const st = content.status || 'published';
    if (st !== 'published') {
      return res.status(403).json({ error: 'No disponible' });
    }
    if (Number(content.is_exclusive) === 1) {
      if (!userId || role !== 'fan') {
        return res.status(403).json({ error: 'Contenido exclusivo' });
      }
      const sub = db
        .prepare(
          "SELECT id FROM subscriptions WHERE fan_id = ? AND creator_id = ? AND status = 'active'"
        )
        .get(userId, content.creator_id);
      if (!sub) {
        return res.status(403).json({ error: 'Contenido exclusivo' });
      }
    }
  }

  const raw = String(content.file_url || '').trim();
  if (!raw || raw.startsWith('text://')) {
    return res.status(404).json({ error: 'Sin archivo' });
  }

  const rel = raw.replace(/^\/+/, '');
  const abs = resolveSafeFile(path.join(__dirname, '..', rel));
  if (!abs || !fs.existsSync(abs)) {
    return res.status(404).end();
  }

  const ext = path.extname(abs).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime'
  };
  const ct = types[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.sendFile(abs);
});

module.exports = router;
