require('dotenv').config();
console.log('MP_CLIENT_SECRET:', process.env.MP_CLIENT_SECRET ? 'OK' : 'MISSING');

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/creators', require('./routes/creators'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/donations', require('./routes/donations'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'BizPonzor' }));

const MP_OAUTH_REDIRECT_URI =
  process.env.MP_REDIRECT_URI || 'https://bizponzor-production.up.railway.app/mp/callback';
const MP_CLIENT_ID = process.env.MP_CLIENT_ID || '2200286157931731';

app.get('/mp/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send('No se recibió el code');
    }

    if (!state) {
      return res.status(400).send('No se recibió el userId');
    }

    const userId = state;

    const clientSecret = process.env.MP_CLIENT_SECRET;
    if (!clientSecret) {
      console.error('[MP OAuth] Falta la variable de entorno MP_CLIENT_SECRET');
      return res.status(500).send('Configuración incompleta del servidor');
    }

    const response = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: MP_CLIENT_ID,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: MP_OAUTH_REDIRECT_URI
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[MP OAuth] Respuesta no OK:', response.status, data);
      return res.status(400).send('No se pudo obtener el token de Mercado Pago');
    }

    if (!data.access_token) {
      console.error('[MP OAuth] Sin access_token en respuesta:', data);
      return res.status(400).send('Respuesta inválida de Mercado Pago');
    }

    const expiresInRaw = Number(data.expires_in);
    const expiresInSec =
      Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? Math.floor(expiresInRaw) : 15552000;

    const mpUserId = data.user_id != null && data.user_id !== '' ? String(data.user_id) : null;

    const upsertMp = db.prepare(`
      INSERT INTO mercado_pago_accounts
      (user_id, access_token, refresh_token, public_key, mp_user_id, expires_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))
      ON CONFLICT(user_id) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        public_key = excluded.public_key,
        mp_user_id = excluded.mp_user_id,
        expires_at = excluded.expires_at
    `);

    upsertMp.run(
      userId,
      data.access_token,
      data.refresh_token ?? null,
      data.public_key ?? null,
      mpUserId,
      expiresInSec
    );

    console.log('MP conectado y guardado para user:', userId);
    console.log('=== MERCADO PAGO TOKEN ===');
    console.log('creator userId (state):', userId);
    console.log(data);

    return res.send('Cuenta de Mercado Pago conectada correctamente');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al conectar con Mercado Pago');
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('BizPonzor corriendo en http://localhost:' + PORT));
