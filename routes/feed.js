const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

/**
 * GET /api/feed?limit=&offset=
 * Fans: contenido de creadores con suscripción activa + descubrimiento (posts no exclusivos).
 */
router.get('/', auth, async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'fan') {
      return res.status(403).json({ error: 'Solo para fans' });
    }

    const fanId = req.user.id;
    const limit = Math.min(40, Math.max(1, parseInt(String(req.query.limit || '15'), 10) || 15));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

    const subscribedRows = await db
      .prepare(
        `SELECT c.*,
          u.name AS creator_name,
          u.handle AS creator_handle,
          u.avatar_url AS creator_avatar_url,
          u.updated_at AS creator_updated_at,
          (SELECT COUNT(*) FROM stars WHERE content_id = c.id) AS stars_count,
          EXISTS(SELECT 1 FROM stars WHERE content_id = c.id AND user_id = ?) AS starred
         FROM content c
         JOIN users u ON c.creator_id = u.id
         WHERE c.creator_id IN (
           SELECT creator_id FROM subscriptions
           WHERE fan_id = ? AND status = 'active'
         )
         AND (c.status IS NULL OR c.status = 'published')
         ORDER BY c.created_at DESC
         LIMIT 220`
      )
      .all(fanId, fanId);

    const discoveryRows = await db
      .prepare(
        `SELECT c.*,
          u.name AS creator_name,
          u.handle AS creator_handle,
          u.avatar_url AS creator_avatar_url,
          u.updated_at AS creator_updated_at,
          (SELECT COUNT(*) FROM stars WHERE content_id = c.id) AS stars_count,
          EXISTS(SELECT 1 FROM stars WHERE content_id = c.id AND user_id = ?) AS starred
         FROM content c
         JOIN users u ON c.creator_id = u.id
         WHERE u.role = 'creator'
         AND (c.is_exclusive = 0 OR c.is_exclusive IS NULL)
         AND (c.status IS NULL OR c.status = 'published')
         ORDER BY c.created_at DESC
         LIMIT 120`
      )
      .all(fanId);

    const byId = new Map();

    for (const row of discoveryRows) {
      const item = mapFeedRow(row, 'discovery');
      byId.set(item.id, item);
    }
    for (const row of subscribedRows) {
      const item = mapFeedRow(row, 'subscribed');
      byId.set(item.id, item);
    }

    const merged = Array.from(byId.values()).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    const total = merged.length;
    const slice = merged.slice(offset, offset + limit);
    const nextOffset = offset + slice.length < total ? offset + slice.length : null;

    res.json({
      items: slice,
      total,
      nextOffset,
      limit
    });
  } catch (e) {
    console.error('[feed GET]', e);
    res.status(500).json({ error: e.message || 'Error al cargar el feed' });
  }
});

function mapFeedRow(row, feedSource) {
  const isExclusive = Number(row.is_exclusive) === 1;
  // Suscripción activa: acceso a exclusivos. Descubrimiento solo trae no exclusivos.
  const locked = false;

  const stars_count = row.stars_count != null ? Number(row.stars_count) : 0;
  const starred = row.starred === 1 || row.starred === true;

  return {
    id: row.id,
    creator_id: row.creator_id,
    title: row.title,
    description: row.description || '',
    type: row.type,
    file_url:
      locked || row.type === 'text' ? (locked ? null : row.file_url) : null,
    thumbnail_url: row.thumbnail_url || null,
    text_body: locked ? null : row.text_body || null,
    background_style: row.background_style || null,
    is_exclusive: isExclusive,
    is_public: !isExclusive,
    locked,
    created_at: row.created_at,
    feed_source: feedSource,
    stars_count,
    starred,
    creator_name: row.creator_name,
    creator_handle: row.creator_handle || '',
    creator: {
      id: row.creator_id,
      name: row.creator_name,
      email: '',
      avatar_url: row.creator_avatar_url,
      avatar_color: null,
      updated_at: row.creator_updated_at
    }
  };
}

module.exports = router;
