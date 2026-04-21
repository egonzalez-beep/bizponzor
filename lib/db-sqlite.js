const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'bizponzor.db');

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

try {
  db.exec('ALTER TABLE users ADD COLUMN location TEXT;');
} catch (e) {
  /* exists */
}

db.exec(`
  CREATE TABLE IF NOT EXISTS mercado_pago_accounts (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    public_key    TEXT,
    mp_user_id    TEXT,
    expires_at    TEXT NOT NULL
  );
`);

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

db.exec(`
  CREATE TABLE IF NOT EXISTS stars (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    content_id  TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, content_id)
  );
  CREATE INDEX IF NOT EXISTS idx_stars_content ON stars(content_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    sender_id   TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    content     TEXT NOT NULL,
    read_at     TEXT DEFAULT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
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

(function migrateContentBackgroundStyle() {
  try {
    db.exec('ALTER TABLE content ADD COLUMN background_style TEXT;');
  } catch (e) {
    /* exists */
  }
})();

(function migrateContentScheduling() {
  try {
    db.exec('ALTER TABLE content ADD COLUMN scheduled_for TEXT;');
  } catch (e) {
    /* exists */
  }
  try {
    db.exec("ALTER TABLE content ADD COLUMN status TEXT DEFAULT 'published';");
  } catch (e) {
    /* exists */
  }
  try {
    db.prepare("UPDATE content SET status = 'published' WHERE status IS NULL").run();
  } catch (e) {
    /* ignore */
  }
})();

// promo_codes.expires_at: SQLite usa TEXT con fechas ISO8601; en PostgreSQL (init.sql) es TIMESTAMPTZ — misma lógica en rutas.
db.exec(`
  CREATE TABLE IF NOT EXISTS promo_codes (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    discount_percent INTEGER DEFAULT 100,
    duration_days INTEGER DEFAULT 7,
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    expires_at TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS promo_redemptions (
    id TEXT PRIMARY KEY,
    promo_code_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    fan_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(promo_code_id, fan_id)
  );
  CREATE INDEX IF NOT EXISTS idx_promo_codes_creator ON promo_codes(creator_id);
`);

try {
  db.exec('ALTER TABLE subscriptions ADD COLUMN promo_code TEXT;');
} catch (e) {
  /* exists */
}
try {
  db.exec('ALTER TABLE subscriptions ADD COLUMN discount_percent INTEGER DEFAULT 0;');
} catch (e) {
  /* exists */
}

try {
  db.exec('ALTER TABLE subscriptions ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0;');
} catch (e) {
  /* exists */
}

try {
  db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT;");
} catch (e) {
  /* exists */
}
try {
  db.prepare("UPDATE users SET updated_at = datetime('now') WHERE updated_at IS NULL").run();
} catch (e) {
  /* ignore */
}

db.exec(`
  CREATE TABLE IF NOT EXISTS deleted_conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    other_user_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, other_user_id)
  );
`);

/** Índices de rendimiento: conversaciones, no leídos, polling (sin cambiar tablas ni queries) */
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, read_at);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender ON messages(receiver_id, sender_id);

  CREATE INDEX IF NOT EXISTS idx_subscriptions_fan ON subscriptions(fan_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_creator ON subscriptions(creator_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

  CREATE INDEX IF NOT EXISTS idx_deleted_conversations_user ON deleted_conversations(user_id, other_user_id);

  CREATE INDEX IF NOT EXISTS idx_users_id ON users(id);
`);

(function migrateUniqueActiveSubscriptionsFanCreator() {
  try {
    const dups = db
      .prepare(
        `SELECT fan_id, creator_id, COUNT(*) AS n
         FROM subscriptions
         WHERE status = 'active'
         GROUP BY fan_id, creator_id
         HAVING n > 1`
      )
      .all();
    for (let i = 0; i < dups.length; i++) {
      const d = dups[i];
      const rows = db
        .prepare(
          `SELECT id, created_at FROM subscriptions
           WHERE fan_id = ? AND creator_id = ? AND status = 'active'
           ORDER BY datetime(created_at) ASC, id ASC`
        )
        .all(d.fan_id, d.creator_id);
      for (let j = 1; j < rows.length; j++) {
        db.prepare(`UPDATE subscriptions SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(
          rows[j].id
        );
      }
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_active_fan_creator
      ON subscriptions(fan_id, creator_id)
      WHERE status = 'active';
    `);
  } catch (e) {
    console.error('[db] unique active subscription (fan+creator):', e.message);
  }
})();

try {
  db.exec('ALTER TABLE users ADD COLUMN is_public INTEGER DEFAULT 1;');
} catch (e) {
  /* exists */
}

['username', 'terms_accepted_at', 'privacy_accepted_at', 'terms_version', 'privacy_version', 'accepted_ip', 'reset_token', 'reset_token_expires'].forEach((col) => {
  const types = {
    username: 'TEXT',
    terms_accepted_at: 'TEXT',
    privacy_accepted_at: 'TEXT',
    terms_version: 'TEXT',
    privacy_version: 'TEXT',
    accepted_ip: 'TEXT',
    reset_token: 'TEXT',
    reset_token_expires: 'TEXT'
  };
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} ${types[col]};`);
  } catch (e) {
    /* exists */
  }
});

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    message     TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',
    is_read     INTEGER NOT NULL DEFAULT 0,
    read_at     TEXT,
    dedupe_key  TEXT UNIQUE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);

  CREATE TABLE IF NOT EXISTS level_up_events (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_level_up_events_user ON level_up_events(user_id);
  CREATE INDEX IF NOT EXISTS idx_level_up_events_created ON level_up_events(created_at DESC);
`);

module.exports = db;
