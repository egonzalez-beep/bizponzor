const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'bizponzor.db');

// Abrir la base de datos
const db = new Database(dbPath);

console.log('🗄️ Base de datos conectada:', dbPath);

// Activar foreign keys
db.pragma('foreign_keys = ON');

// ─── SCHEMA ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK(role IN ('creator','fan')),
    handle      TEXT UNIQUE,
    bio         TEXT,
    category    TEXT,
    avatar_url  TEXT,
    banner_url  TEXT,
    mp_access_token TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plans (
    id          TEXT PRIMARY KEY,
    creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    price       REAL NOT NULL,
    currency    TEXT DEFAULT 'USD',
    description TEXT,
    features    TEXT,
    is_featured INTEGER DEFAULT 0,
    mp_plan_id  TEXT,
    active      INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content (
    id           TEXT PRIMARY KEY,
    creator_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,
    type         TEXT NOT NULL CHECK(type IN ('photo','video')),
    file_url     TEXT NOT NULL,
    thumbnail_url TEXT,
    is_exclusive INTEGER DEFAULT 1,
    views        INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id              TEXT PRIMARY KEY,
    fan_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id         TEXT NOT NULL REFERENCES plans(id),
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','active','cancelled','expired')),
    mp_subscription_id TEXT,
    mp_payment_id   TEXT,
    amount          REAL,
    next_billing    TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id              TEXT PRIMARY KEY,
    subscription_id TEXT REFERENCES subscriptions(id),
    fan_id          TEXT NOT NULL REFERENCES users(id),
    creator_id      TEXT NOT NULL REFERENCES users(id),
    amount          REAL NOT NULL,
    currency        TEXT DEFAULT 'USD',
    status          TEXT DEFAULT 'pending',
    mp_payment_id   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );
`);

try {
  db.exec("ALTER TABLE users ADD COLUMN avatar_color TEXT DEFAULT '#333333';");
} catch (e) {
  // Column may already exist on existing databases.
}

module.exports = db;
