
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

    const receiver = db.prepare('SELECT id, role FROM users WHERE id = ?').get(receiverId);
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

    const subscription = db
      .prepare(
        `SELECT id FROM subscriptions
         WHERE fan_id = ? AND creator_id = ? AND status = 'active'`
      )
      .get(fanId, creatorId);

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

router.get('/conversation/:userId', auth, (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const myId = req.user.id;

    const other = db.prepare('SELECT id, role FROM users WHERE id = ?').get(otherUserId);
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

    const sub = db
      .prepare(
        `SELECT id FROM subscriptions WHERE fan_id = ? AND creator_id = ? AND status = 'active'`
      )
      .get(fanId, creatorId);
    if (!sub) {
      return res.status(403).json({ error: 'No hay suscripción activa' });
    }

    const messages = db
      .prepare(
        `SELECT m.*, u.handle, u.name as sender_name
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         WHERE
           (m.sender_id = ? AND m.receiver_id = ?)
           OR
           (m.sender_id = ? AND m.receiver_id = ?)
         ORDER BY datetime(m.created_at) ASC`
      )
      .all(myId, otherUserId, otherUserId, myId);

    res.json(messages);
  } catch (error) {
    console.error('Error conversación:', error);
    res.status(500).json({ error: 'Error al obtener conversación' });
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
