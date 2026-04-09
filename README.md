# 🚀 BizPonzor — Plataforma de Creadores

> La plataforma latinoamericana para monetizar contenido con MercadoPago.

## ✨ Características

- ✅ Registro/Login para Creadores y Fans (JWT)
- ✅ Subida de fotos y videos (hasta 4GB)
- ✅ Control de acceso: contenido exclusivo para suscriptores
- ✅ Planes de suscripción (Básico, Premium, VIP)
- ✅ Integración MercadoPago (modo demo + producción real)
- ✅ Dashboard del Creador con estadísticas
- ✅ Dashboard del Fan con feed de contenido
- ✅ Perfiles públicos de creadores
- ✅ Webhook de MercadoPago para activar pagos automáticamente

## 📁 Estructura

```
bizponzor/
├── server.js          # Servidor Express principal
├── db.js              # Base de datos SQLite
├── .env               # Variables de entorno
├── routes/
│   ├── auth.js        # Register, Login, Perfil
│   ├── content.js     # Subir/listar contenido (con acceso)
│   ├── plans.js       # CRUD de planes de suscripción
│   ├── subscriptions.js # Checkout, activación, estadísticas
│   ├── creators.js    # Perfiles públicos
│   └── webhook.js     # Webhook de MercadoPago
├── middleware/
│   └── auth.js        # Verificación JWT
├── public/
│   └── index.html     # Frontend completo
└── uploads/           # Archivos subidos por creadores
```

## 🔧 Instalación

### 1. Prerrequisitos
- Node.js 18+ instalado
- Cuenta de MercadoPago (para pagos reales)

### 2. Instalar dependencias
```bash
npm install express better-sqlite3 multer jsonwebtoken bcryptjs mercadopago cors dotenv uuid
```

### 3. Configurar variables de entorno
Edita el archivo `.env`:
```env
PORT=3000
JWT_SECRET=tu_clave_secreta_muy_segura

# MercadoPago (obtenlas en developers.mercadopago.com)
MP_ACCESS_TOKEN=APP_USR-xxxxx-xxxxx-xxxxx
MP_PUBLIC_KEY=APP_USR-xxxxx
MP_WEBHOOK_SECRET=tu_webhook_secret

# URL de tu dominio en producción
APP_URL=https://tudominio.com
```

### 4. Correr la app
```bash
node server.js
```
Abre: http://localhost:3000

## 💳 Integrar MercadoPago (Pagos Reales)

1. Ve a **developers.mercadopago.com** → Tus apps → Crear app
2. Copia tu **Access Token** y **Public Key** de producción
3. Pégalas en `.env`
4. Configura el Webhook en MercadoPago → apunta a: `https://tudominio.com/api/webhook/mp`
5. Reinicia el servidor

En modo demo (sin configurar MP), las suscripciones se activan automáticamente al hacer click en "Pagar".

## 🌐 Endpoints API

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/auth/register | Registrar usuario (creator/fan) |
| POST | /api/auth/login | Iniciar sesión |
| GET | /api/auth/me | Perfil del usuario autenticado |
| PUT | /api/auth/profile | Actualizar perfil |

### Contenido
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/content/upload | Subir foto/video (solo creadores) |
| GET | /api/content/feed/:creatorId | Feed con control de acceso |
| GET | /api/content/my | Mi contenido (creador) |
| DELETE | /api/content/:id | Eliminar contenido |

### Planes y Suscripciones
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /api/plans/:creatorId | Planes de un creador |
| POST | /api/plans | Crear plan (creador) |
| POST | /api/subscriptions/checkout | Iniciar pago con MP |
| POST | /api/subscriptions/activate/:id | Activar suscripción |
| GET | /api/subscriptions/my | Mis suscripciones |
| GET | /api/subscriptions/stats | Estadísticas (creador) |

## 🚀 Deploy en Producción

### Railway (recomendado — gratis para empezar)
1. Sube el código a GitHub
2. Ve a railway.app → New Project → Deploy from GitHub
3. Agrega las variables de entorno en el panel de Railway
4. ¡Listo! Railway asigna un dominio automático

### Render / Heroku
También compatibles. Solo asegura que el `PORT` lo lea de `process.env.PORT`.

## 💰 Modelo de Negocio

BizPonzor puede cobrar una comisión del 5-10% por cada pago procesado. Esto se puede implementar en el webhook ajustando el monto antes de acreditar al creador.

---
© 2025 BizPonzor · Hecho con ❤️ en Latinoamérica
