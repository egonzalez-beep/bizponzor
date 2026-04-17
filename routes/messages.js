
const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const auth = require('../middleware/auth');

router.post('/:id/read', auth, async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user.id;

    const message = await db.prepare('SELECT receiver_id FROM messages WHERE id = ?').get(messageId);

    if (!message || message.receiver_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    await db.prepare(`
      UPDATE messages SET read_at = datetime('now')
      WHERE id = ? AND read_at IS NULL
    `).run(messageId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error al marcar como leído:', error);
    res.status(500).json({ error: 'Error al marcar como leído' });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiverId, content } = req.body;

    if (!receiverId || content == null) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    const text = String(content).trim();
    if (!text) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }

    if (senderId === receiverId) {
      return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });
    }

    const receiver = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(receiverId);
    if (!receiver) {
      return res.status(404).json({ error: 'Destinatario no existe' });
    }

    let fanId;
    let creatorId;
    if (req.user.role === 'fan' && receiver.role === 'creator') {
      fanId = senderId;
      creatorId = receiverId;
    } else if (req.user.role === 'creator' && receiver.role === 'fan') {
      creatorId = senderId;
      fanId = receiverId;
    } else {
      return res.status(400).json({ error: 'Solo mensajes entre fan y creador' });
    }

    const subscription = await db
      .prepare(
        `SELECT id FROM subscriptions
         WHERE fan_id = ? AND creator_id = ? AND status = 'active'`
      )
      .get(fanId, creatorId);

    if (!subscription) {
      return res.status(403).json({ error: 'Debes estar suscrito para enviar mensajes' });
    }

    await db
      .prepare(
        `INSERT INTO messages (id, sender_id, receiver_id, content)
       VALUES (?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), senderId, receiverId, text.slice(0, 8000));

    return res.json({ success: true });
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({ error: 'Error interno al enviar mensaje' });
  }
});

router.get('/conversation/:userId', auth, async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const myId = req.user.id;

    const other = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(otherUserId);
    if (!other) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    let fanId;
    let creatorId;
    if (req.user.role === 'creator' && other.role === 'fan') {
      creatorId = myId;
      fanId = otherUserId;
    } else if (req.user.role === 'fan' && other.role === 'creator') {
      fanId = myId;
      creatorId = otherUserId;
    } else {
      return res.status(403).json({ error: 'Conversación no permitida' });
    }

    const sub = await db
      .prepare(
        `SELECT id FROM subscriptions WHERE fan_id = ? AND creator_id = ? AND status = 'active'`
      )
      .get(fanId, creatorId);
    if (!sub) {
      return res.status(403).json({ error: 'No hay suscripción activa' });
    }

    const rows = await db
      .prepare(
        `SELECT
           m.id,
           m.sender_id,
           m.receiver_id,
           m.content,
           m.created_at,
           m.read_at,
           u.id AS sender_user_id,
           u.name AS sender_name,
           u.avatar_url AS sender_avatar_url,
           u.avatar_color AS sender_avatar_color,
           u.updated_at AS sender_updated_at
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE
           (m.sender_id = ? AND m.receiver_id = ?)
           OR
           (m.sender_id = ? AND m.receiver_id = ?)
         ORDER BY datetime(m.created_at) ASC`
      )
      .all(myId, otherUserId, otherUserId, myId);

    const messages = rows.map((row) => {
      const missing = !row.sender_user_id;
      return {
        id: row.id,
        sender_id: row.sender_id,
        receiver_id: row.receiver_id,
        content: row.content,
        created_at: row.created_at,
        read_at: row.read_at,
        sender: {
          id: missing ? 'deleted' : row.sender_user_id,
          name: missing ? 'Usuario eliminado' : row.sender_name || 'Usuario',
          avatar_url: row.sender_avatar_url || null,
          avatar_color: row.sender_avatar_color || null,
          updated_at: row.sender_updated_at || null
        }
      };
    });

    res.json(messages);
  } catch (error) {
    console.error('Error conversación:', error);
    res.status(500).json({ error: 'Error al obtener conversación' });
  }
});

/**
 * GET /api/messages/conversations
 * Lista conversaciones en una sola query (fan: por suscripciones activas; creador: hilos con mensajes + sub activa).
 */
router.get('/conversations', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;

    if (userRole === 'fan') {
      const rows = await db
        .prepare(
          `SELECT 
            c.id AS user_id,
            c.handle AS user_handle,
            c.name AS user_name,
            (
              SELECT content FROM messages 
              WHERE (sender_id = ? AND receiver_id = c.id) 
                 OR (sender_id = c.id AND receiver_id = ?)
              ORDER BY datetime(created_at) DESC LIMIT 1
            ) AS last_message,
            (
              SELECT created_at FROM messages 
              WHERE (sender_id = ? AND receiver_id = c.id) 
                 OR (sender_id = c.id AND receiver_id = ?)
              ORDER BY datetime(created_at) DESC LIMIT 1
            ) AS last_message_at,
            (
              SELECT COUNT(*) FROM messages 
              WHERE sender_id = c.id AND receiver_id = ? AND read_at IS NULL
            ) AS unread_count
          FROM subscriptions s
          JOIN users c ON c.id = s.creator_id
          WHERE s.fan_id = ? AND s.status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM deleted_conversations dc
              WHERE dc.user_id = ? AND dc.other_user_id = c.id
            )
          ORDER BY (last_message_at IS NULL), datetime(last_message_at) DESC`
        )
        .all(userId, userId, userId, userId, userId, userId, userId);

      return res.json(
        rows.map((conv) => ({
          user_id: conv.user_id,
          user_handle: conv.user_handle || '',
          user_name: conv.user_name || '',
          last_message: conv.last_message || '',
          last_message_at: conv.last_message_at,
          unread_count: Number(conv.unread_count) || 0
        }))
      );
    }

    if (userRole === 'creator') {
      const rows = await db
        .prepare(
          `SELECT 
            u.id AS user_id,
            u.handle AS user_handle,
            u.name AS user_name,
            (
              SELECT content FROM messages 
              WHERE (sender_id = u.id AND receiver_id = ?) 
                 OR (sender_id = ? AND receiver_id = u.id)
              ORDER BY datetime(created_at) DESC LIMIT 1
            ) AS last_message,
            (
              SELECT created_at FROM messages 
              WHERE (sender_id = u.id AND receiver_id = ?) 
                 OR (sender_id = ? AND receiver_id = u.id)
              ORDER BY datetime(created_at) DESC LIMIT 1
            ) AS last_message_at,
            (
              SELECT COUNT(*) FROM messages 
              WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL
            ) AS unread_count
          FROM (
            SELECT DISTINCT
              CASE 
                WHEN m.sender_id = ? THEN m.receiver_id
                WHEN m.receiver_id = ? THEN m.sender_id
              END AS fan_id
            FROM messages m
            WHERE m.sender_id = ? OR m.receiver_id = ?
          ) AS p
          JOIN users u ON u.id = p.fan_id AND u.role = 'fan'
          WHERE p.fan_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM subscriptions s
              WHERE s.creator_id = ? AND s.fan_id = u.id AND s.status = 'active'
            )
            AND NOT EXISTS (
              SELECT 1 FROM deleted_conversations dc
              WHERE dc.user_id = ? AND dc.other_user_id = u.id
            )
          ORDER BY (last_message_at IS NULL), datetime(last_message_at) DESC`
        )
        .all(
          userId,
          userId,
          userId,
          userId,
          userId,
          userId,
          userId,
          userId,
          userId,
          userId,
          userId
        );

      return res.json(
        rows.map((conv) => ({
          user_id: conv.user_id,
          user_handle: conv.user_handle || '',
          user_name: conv.user_name || '',
          last_message: conv.last_message || '',
          last_message_at: conv.last_message_at,
          unread_count: Number(conv.unread_count) || 0
        }))
      );
    }

    return res.status(403).json({ error: 'No permitido' });
  } catch (error) {
    console.error('Error conversaciones:', error);
    res.status(500).json({ error: 'Error al obtener conversaciones' });
  }
});

/**
 * POST /api/messages/conversations/:userId/delete
 * Soft-delete: el usuario actual deja de ver el hilo; no se borran filas en messages.
 */
router.post('/conversations/:userId/delete', auth, async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const otherUserId = req.params.userId;
    if (!otherUserId || otherUserId === currentUserId) {
      return res.status(400).json({ error: 'Solicitud inválida' });
    }

    const other = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(otherUserId);
    if (!other) return res.status(404).json({ error: 'Usuario no encontrado' });

    let fanId;
    let creatorId;
    if (req.user.role === 'fan' && other.role === 'creator') {
      fanId = currentUserId;
      creatorId = otherUserId;
    } else if (req.user.role === 'creator' && other.role === 'fan') {
      creatorId = currentUserId;
      fanId = otherUserId;
    } else {
      return res.status(403).json({ error: 'No permitido' });
    }

    const sub = await db
      .prepare(
        `SELECT id FROM subscriptions WHERE fan_id = ? AND creator_id = ? AND status = 'active'`
      )
      .get(fanId, creatorId);
    if (!sub) {
      return res.status(403).json({ error: 'No hay suscripción activa' });
    }

    await db
      .prepare(
        `INSERT OR IGNORE INTO deleted_conversations (id, user_id, other_user_id)
       VALUES (?, ?, ?)`
      )
      .run(crypto.randomUUID(), currentUserId, otherUserId);

    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting conversation:', err);
    return res.status(500).json({ error: 'Error deleting conversation' });
  }
});

router.get('/:userId', auth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const loggedUserId = req.user.id;

    if (loggedUserId !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (!user || user.role !== 'creator') {
      return res.status(403).json({ error: 'Solo los creadores pueden ver mensajes' });
    }

    const messages = await db
      .prepare(
        `SELECT m.*, u.handle, u.email, u.name as sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE m.receiver_id = ?
         ORDER BY (m.read_at IS NULL) DESC, m.created_at DESC`
      )
      .all(userId);

    return res.json(messages);
  } catch (error) {
    console.error('Error al obtener mensajes:', error);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

module.exports = router;
