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

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN mp_subscription_id TEXT;");
} catch (e) {
  // Column may already exist on existing databases.
}

try {
  db.exec("ALTER TABLE subscriptions ADD COLUMN mp_preapproval_status TEXT;");
} catch (e) {
  // Column may already exist on existing databases.
}

['social_instagram', 'social_facebook', 'social_tiktok', 'social_other'].forEach((col) => {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT;`);
  } catch (e) {
    /* exists */
  }
});

db.exec(`
  CREATE TABLE IF NOT EXISTS donations (
    id              TEXT PRIMARY KEY,
    fan_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    creator_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount          REAL NOT NULL,
    currency_id     TEXT DEFAULT 'MXN',
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),
    mp_preference_id TEXT,
    mp_payment_id   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS content_likes (
    id         TEXT PRIMARY KEY,
    content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    fan_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(content_id, fan_id)
  );
  CREATE INDEX IF NOT EXISTS idx_content_likes_content ON content_likes(content_id);
`);

(function migrateContentForTextType() {
  try {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='content'")
      .get();
    if (!row || !row.sql || row.sql.includes("'text'")) return;
    db.exec(`
      CREATE TABLE content_new (
        id           TEXT PRIMARY KEY,
        creator_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        description  TEXT,
        type         TEXT NOT NULL CHECK(type IN ('photo','video','text')),
        file_url     TEXT NOT NULL DEFAULT '',
        thumbnail_url TEXT,
        is_exclusive INTEGER DEFAULT 1,
        views        INTEGER DEFAULT 0,
        text_body    TEXT,
        created_at   TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO content_new (id, creator_id, title, description, type, file_url, thumbnail_url, is_exclusive, views, created_at, text_body)
      SELECT id, creator_id, title, description, type, file_url, thumbnail_url, is_exclusive, views, created_at, NULL FROM content;
      DROP TABLE content;
      ALTER TABLE content_new RENAME TO content;
    `);
    console.log('✅ Migración content: soporte tipo texto');
  } catch (e) {
    console.error('⚠️ Migración content (texto):', e.message);
  }
})();

module.exports = db;
