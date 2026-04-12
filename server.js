if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const cors = require('cors');
const path = require('path');

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
    const { code } = req.query;

    if (!code) {
      return res.status(400).send('No se recibió el code');
    }

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
    }

    console.log('=== MERCADO PAGO TOKEN ===');
    console.log(data);

    return res.send('Cuenta de Mercado Pago conectada correctamente');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al conectar con Mercado Pago');
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log('BizPonzor corriendo en http://localhost:' + PORT));
