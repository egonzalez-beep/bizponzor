const crypto = require('crypto');
const db = require('../db');

const VALID_TYPES = ['NEW_SUBSCRIBER', 'NEW_DONATION', 'NEW_CONTENT', 'SYSTEM'];

/**
 * Genera título y mensaje en servidor (no en frontend).
 * @param {string} type
 * @param {object} metadata
 * @returns {{ title: string, message: string | null }}
 */
function buildCopy(type, metadata) {
  const m = metadata && typeof metadata === 'object' ? metadata : {};
  switch (type) {
    case 'NEW_SUBSCRIBER': {
      const name = m.fanName ? String(m.fanName) : 'Un fan';
      const plan = m.planName ? String(m.planName) : '';
      const msg = plan ? `${name} se suscribió (${plan})` : `${name} se suscribió a tu plan`;
      return { title: 'Nuevo suscriptor', message: msg };
    }
    case 'NEW_DONATION': {
      const who = m.senderName ? String(m.senderName) : 'Un fan';
      const amt = m.amount != null ? Number(m.amount) : null;
      const cur = m.currency ? String(m.currency) : 'MXN';
      const msg =
        amt != null && Number.isFinite(amt)
          ? `${who} te donó $${amt} ${cur}`
          : `${who} completó una donación`;
      return { title: 'Nueva donación', message: msg };
    }
    case 'NEW_CONTENT': {
      const label = m.contentLabel ? String(m.contentLabel) : 'Tu contenido ya está visible en tu perfil.';
      return { title: 'Publicación lista', message: label };
    }
    case 'SYSTEM':
    default: {
      return {
        title: m.title ? String(m.title) : 'Aviso',
        message: m.message != null ? String(m.message) : null
      };
    }
  }
}

/**
 * @param {{ userId: string, type: string, metadata?: object, dedupeKey?: string | null }} data
 * @returns {Promise<{ id: string } | null>}
 */
function createNotification(data) {
  return new Promise((resolve, reject) => {
    try {
      const { userId, type, metadata, dedupeKey } = data || {};
      if (!userId || !VALID_TYPES.includes(type)) {
        resolve(null);
        return;
      }
      if (dedupeKey) {
        const row = db.prepare('SELECT id FROM notifications WHERE dedupe_key = ?').get(dedupeKey);
        if (row) {
          resolve(null);
          return;
        }
      }
      const { title, message } = buildCopy(type, metadata);
      const id = crypto.randomUUID();
      const metaJson = JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {});
      db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, message, metadata, is_read, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, datetime('now'))`
      ).run(id, userId, type, title, message, metaJson, dedupeKey || null);
      resolve({ id });
    } catch (e) {
      if (e && String(e.message).includes('UNIQUE')) {
        resolve(null);
        return;
      }
      reject(e);
    }
  });
}

function fireAndForget(promise) {
  promise.catch(() => null);
}

module.exports = {
  createNotification,
  fireAndForget,
  buildCopy,
  VALID_TYPES
};
