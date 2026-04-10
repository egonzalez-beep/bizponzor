
const router = require('express').Router();
const db = require('../db');

router.post('/mp', async (req, res) => {
  try {
    console.log('[WEBHOOK] Recibido:', JSON.stringify(req.body, null, 2));
    
    const { type, data, action } = req.body;
    
    // Manejar pago aprobado
    if (type === 'payment' && data?.id) {
      const paymentId = data.id;
      console.log('[WEBHOOK] Procesando pago:', paymentId);
      
      // Buscar la suscripción pendiente
      const subscription = db.prepare(`
        SELECT * FROM subscriptions WHERE mp_payment_id = ? OR id = (
          SELECT subscription_id FROM payments WHERE mp_payment_id = ?
        )
      `).get(paymentId, paymentId);
      
      if (!subscription) {
        console.log('[WEBHOOK] No se encontró suscripción para pago:', paymentId);
        return res.sendStatus(200);
      }
      
      // Calcular próxima fecha de facturación (1 mes)
      const nextBilling = new Date();
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      
      // Activar la suscripción
      db.prepare(`
        UPDATE subscriptions 
        SET status = 'active', 
            mp_payment_id = ?, 
            next_billing = ?, 
            updated_at = datetime('now')
        WHERE id = ?
      `).run(paymentId, nextBilling.toISOString(), subscription.id);
      
      // Registrar el pago
      db.prepare(`
        INSERT OR REPLACE INTO payments (id, subscription_id, fan_id, creator_id, amount, status, mp_payment_id, created_at)
        VALUES (?, ?, ?, ?, ?, 'approved', ?, datetime('now'))
      `).run(
        paymentId,
        subscription.id,
        subscription.fan_id,
        subscription.creator_id,
        subscription.amount,
        paymentId
      );
      
      console.log('[WEBHOOK] Suscripción activada:', subscription.id);
    }
    
    // Manejar suscripción pre-aprobada (Mercado Pago recurring)
    if (type === 'subscription_preapproval') {
      const mpSubscriptionId = data.id;
      console.log('[WEBHOOK] Procesando preaprobación:', mpSubscriptionId);
      
      if (action === 'created' || action === 'updated') {
        db.prepare(`
          UPDATE subscriptions 
          SET status = 'active', 
              mp_subscription_id = ?, 
              updated_at = datetime('now')
          WHERE mp_subscription_id = ? OR id = (SELECT subscription_id FROM payments WHERE mp_payment_id = ?)
        `).run(mpSubscriptionId, mpSubscriptionId, mpSubscriptionId);
      }
      
      if (action === 'cancelled') {
        db.prepare(`
          UPDATE subscriptions 
          SET status = 'cancelled', 
              updated_at = datetime('now')
          WHERE mp_subscription_id = ?
        `).run(mpSubscriptionId);
      }
    }
    
    res.sendStatus(200);
  } catch (e) {
    console.error('[WEBHOOK] Error:', e.message);
    res.sendStatus(200); // Siempre responder 200 a MP
  }
});

module.exports = router;
