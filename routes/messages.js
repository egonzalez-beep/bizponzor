
const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db');
const auth = require('../middleware/auth');

router.post('/:id/read', auth, (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.user.id;

    const message = db.prepare('SELECT receiver_id FROM messages WHERE id = ?').get(messageId);

    if (!message || message.receiver_id !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    db.prepare(`
      UPDATE messages SET read_at = datetime('now')
      WHERE id = ? AND read_at IS NULL
    `).run(messageId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error al marcar como leído:', error);
    res.status(500).json({ error: 'Error al marcar como leído' });
  }
});

router.post('/', auth, (req, res) => {
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

    const creator = db
      .prepare('SELECT id FROM users WHERE id = ? AND role = ?')
      .get(receiverId, 'creator');

    if (!creator) {
      return res.status(404).json({ error: 'Creador no existe' });
    }

    const subscription = db
      .prepare(
        `SELECT id FROM subscriptions
         WHERE fan_id = ? AND creator_id = ? AND status = 'active'`
      )
      .get(senderId, receiverId);

    if (!subscription) {
      return res.status(403).json({ error: 'Debes estar suscrito para enviar mensajes' });
    }

    db.prepare(
      `INSERT INTO messages (id, sender_id, receiver_id, content)
       VALUES (?, ?, ?, ?)`
    ).run(crypto.randomUUID(), senderId, receiverId, text.slice(0, 8000));

    return res.json({ success: true });
  } catch (error) {
    console.error('Error al enviar mensaje:', error);
    res.status(500).json({ error: 'Error interno al enviar mensaje' });
  }
});

router.get('/:userId', auth, (req, res) => {
  try {
    const userId = req.params.userId;
    const loggedUserId = req.user.id;

    if (loggedUserId !== userId) {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    if (!user || user.role !== 'creator') {
      return res.status(403).json({ error: 'Solo los creadores pueden ver mensajes' });
    }

    const messages = db
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
