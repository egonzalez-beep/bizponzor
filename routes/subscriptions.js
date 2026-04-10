
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const auth = require('../middleware/auth');
const { MercadoPagoConfig, Preference } = require('mercadopago');

// Iniciar proceso de suscripcion con MercadoPago
router.post('/checkout', auth, async (req, res) => {
  try {
    if (req.user.role !== 'fan') return res.status(403).json({ error: 'Solo fans' });
    const { plan_id, creator_id } = req.body;
    const plan = db.prepare('SELECT * FROM plans WHERE id=? AND creator_id=? AND active=1').get(plan_id, creator_id);
    const creator = db.prepare('SELECT id, name, mp_access_token FROM users WHERE id=? AND role=?').get(creator_id, 'creator');
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    if (!creator) return res.status(404).json({ error: 'Creador no encontrado' });
    console.log('[MP] Iniciando creación de preferencia con:', {
      access_token_prefix: process.env.MP_ACCESS_TOKEN?.substring(0, 15),
      plan_price: plan.price,
      currency: 'MXN',
      creator_id: creator_id
    });
    
    const sub_id = uuidv4();
    db.prepare('INSERT INTO subscriptions (id, fan_id, creator_id, plan_id, status, amount) VALUES (?,?,?,?,?,?)')
      .run(sub_id, req.user.id, creator_id, plan_id, 'pending', plan.price);

    // Si MP no esta configurado, modo demo
    const isDemo = !process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN === 'TU_ACCESS_TOKEN_AQUI';
    if (isDemo) {
      return res.json({ demo_mode: true, sub_id, message: 'Modo demo activo. Configura MP_ACCESS_TOKEN para pagos reales.' });
    }
    
    // MercadoPago real
    const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
    const preference = new Preference(client);

    const preferenceData = {
      body: {
        items: [{
          id: plan_id,
          title: `BizPonzor - ${plan.name} - ${creator.name}`,
          quantity: 1,
          unit_price: 10,
          currency_id: 'MXN'
        }],
        marketplace_fee: Math.round(plan.price * 0.15 * 100) / 100,  // 15% de comisión para la plataforma
        payer: { email: req.user.email },
        back_urls: {
          success: process.env.APP_URL + '/success?sub=' + sub_id,
          failure: process.env.APP_URL + '/failure',
          pending: process.env.APP_URL + '/pending'
        },
        auto_return: 'approved',
        notification_url: process.env.APP_URL + '/api/webhook/mp',
        external_reference: sub_id,
        metadata: { sub_id, fan_id: req.user.id, creator_id, plan_id }
      }
    };

    try {
      const response = await preference.create(preferenceData);
      console.log('[MP] Preferencia creada:', response.id);
      res.json({ checkout_url: response.init_point, preference_id: response.id, sub_id });
    } catch (mpError) {
      console.error('[MP] Error al crear preferencia:', {
        message: mpError.message,
        status: mpError.status,
        response: mpError.response?.data
      });
      return res.status(500).json({ error: 'Error al conectar con MercadoPago: ' + mpError.message });
    }
  } catch (e) {
    // Si MP no está configurado, simular para demo
    if (e.message && e.message.includes('ACCESS_TOKEN')) {
      const sub_id = uuidv4();
      const { plan_id, creator_id } = req.body;
      const plan = db.prepare('SELECT * FROM plans WHERE id=? AND active=1').get(plan_id);
      db.prepare('INSERT INTO subscriptions (id, fan_id, creator_id, plan_id, status, amount) VALUES (?,?,?,?,?,?)')
        .run(sub_id, req.user.id, creator_id, plan_id, 'pending', plan ? plan.price : 0);
      res.json({ demo_mode: true, sub_id, message: 'Modo demo: configura MP_ACCESS_TOKEN para pagos reales' });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// Activar suscripcion (demo/webhook)
router.post('/activate/:sub_id', auth, (req, res) => {
  const sub = db.prepare('SELECT * FROM subscriptions WHERE id=?').get(req.params.sub_id);
  if (!sub) return res.status(404).json({ error: 'No encontrado' });
  const nextBilling = new Date(); nextBilling.setMonth(nextBilling.getMonth() + 1);
  db.prepare("UPDATE subscriptions SET status='active', next_billing=?, updated_at=datetime('now') WHERE id=?").run(nextBilling.toISOString(), sub.id);
  res.json({ success: true, status: 'active' });
});

// Mis suscripciones (fan)
router.get('/my', auth, (req, res) => {
  if (req.user.role === 'fan') {
    const subs = db.prepare("SELECT s.*, u.name as creator_name, u.handle, u.avatar_url, p.name as plan_name, p.price FROM subscriptions s JOIN users u ON s.creator_id=u.id JOIN plans p ON s.plan_id=p.id WHERE s.fan_id=? AND s.status='active'").all(req.user.id);
    res.json(subs);
  } else {
    const subs = db.prepare("SELECT s.*, u.name as fan_name, u.email as fan_email, p.name as plan_name, p.price FROM subscriptions s JOIN users u ON s.fan_id=u.id JOIN plans p ON s.plan_id=p.id WHERE s.creator_id=? AND s.status='active'").all(req.user.id);
    res.json(subs);
  }
});

// Cancelar
router.post('/cancel/:id', auth, (req, res) => {
  db.prepare("UPDATE subscriptions SET status='cancelled' WHERE id=? AND fan_id=?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Stats para creador
router.get('/stats', auth, (req, res) => {
  if (req.user.role !== 'creator') return res.status(403).json({ error: 'Solo creadores' });
  const total = db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE creator_id=? AND status='active'").get(req.user.id);
  const revenue = db.prepare("SELECT SUM(amount) as total FROM subscriptions WHERE creator_id=? AND status='active'").get(req.user.id);
  const content = db.prepare("SELECT COUNT(*) as count FROM content WHERE creator_id=?").get(req.user.id);
  res.json({ subscribers: total.count, monthly_revenue: revenue.total || 0, content_count: content.count });
});

module.exports = router;
