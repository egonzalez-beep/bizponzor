
const router = require('express').Router();
const db = require('../db');

// Webhook de MercadoPago
router.post('/mp', async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === 'payment') {
      const { MercadoPagoConfig, Payment } = require('mercadopago');
      const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
      const payment = new Payment(client);
      const info = await payment.get({ id: data.id });
      if (info.status === 'approved') {
        const sub_id = info.external_reference;
        const nextBilling = new Date(); nextBilling.setMonth(nextBilling.getMonth() + 1);
        db.prepare("UPDATE subscriptions SET status='active', mp_payment_id=?, next_billing=?, updated_at=datetime('now') WHERE id=?")
          .run(String(info.id), nextBilling.toISOString(), sub_id);
        console.log('Suscripcion activada:', sub_id);
      }
    }
    res.sendStatus(200);
  } catch (e) { console.error('Webhook error:', e.message); res.sendStatus(200); }
});

module.exports = router;
