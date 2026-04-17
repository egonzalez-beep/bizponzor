const router = require('express').Router();
const db = require('../db');
const auth = require('../middleware/auth');

function rowToApi(n) {
  let meta = {};
  try {
    meta = n.metadata ? JSON.parse(n.metadata) : {};
  } catch {
    meta = {};
  }
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    metadata: meta,
    isRead: !!n.is_read,
    readAt: n.read_at || null,
    createdAt: n.created_at
  };
}

/** GET /api/notifications/unread-count (antes de GET / para claridad) */
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const row = await db
      .prepare(
        `SELECT COUNT(*) as c FROM notifications
         WHERE user_id = ?
           AND is_read = 0
           AND datetime(created_at) >= datetime('now', '-30 days')`
      )
      .get(userId);
    res.json({ unreadCount: row ? Number(row.c) : 0 });
  } catch (e) {
    console.error('[notifications unread-count]', e);
    res.status(500).json({ error: e.message || 'Error interno' });
  }
});

/** PATCH /api/notifications/read-all */
router.patch('/read-all', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await db
      .prepare(
        `UPDATE notifications
         SET is_read = 1, read_at = datetime('now')
         WHERE user_id = ?
           AND is_read = 0
           AND datetime(created_at) >= datetime('now', '-30 days')`
      )
      .run(userId);
    res.json({ success: true, updated: r.changes });
  } catch (e) {
    console.error('[notifications read-all]', e);
    res.status(500).json({ error: e.message || 'Error interno' });
  }
});

/** GET /api/notifications?cursor=&limit=15 */
router.get('/', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 15, 1), 30);
    const cursor = req.query.cursor ? String(req.query.cursor).trim() : '';

    const unreadRow = await db
      .prepare(
        `SELECT COUNT(*) as c FROM notifications
         WHERE user_id = ?
           AND is_read = 0
           AND datetime(created_at) >= datetime('now', '-30 days')`
      )
      .get(userId);
    const unreadCount = unreadRow ? Number(unreadRow.c) : 0;

    const fetchLimit = limit + 1;
    let rows;
    if (cursor) {
      rows = await db
        .prepare(
          `SELECT * FROM notifications
           WHERE user_id = ?
             AND datetime(created_at) >= datetime('now', '-30 days')
             AND datetime(created_at) < datetime(?)
           ORDER BY datetime(created_at) DESC
           LIMIT ?`
        )
        .all(userId, cursor, fetchLimit);
    } else {
      rows = await db
        .prepare(
          `SELECT * FROM notifications
           WHERE user_id = ?
             AND datetime(created_at) >= datetime('now', '-30 days')
           ORDER BY datetime(created_at) DESC
           LIMIT ?`
        )
        .all(userId, fetchLimit);
    }

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const list = slice.map(rowToApi);
    const nextCursor = hasMore && slice.length ? slice[slice.length - 1].created_at : null;

    res.json({
      notifications: list,
      nextCursor,
      unreadCount
    });
  } catch (e) {
    console.error('[notifications GET]', e);
    res.status(500).json({ error: e.message || 'Error interno' });
  }
});

/** PATCH /api/notifications/:id/read */
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const id = req.params.id;
    const n = await db.prepare('SELECT id FROM notifications WHERE id = ? AND user_id = ?').get(id, userId);
    if (!n) return res.status(404).json({ error: 'No encontrado' });
    await db
      .prepare(`UPDATE notifications SET is_read = 1, read_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .run(id, userId);
    res.json({ success: true });
  } catch (e) {
    console.error('[notifications read one]', e);
    res.status(500).json({ error: e.message || 'Error interno' });
  }
});

module.exports = router;
