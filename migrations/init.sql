-- BizPonzor — esquema PostgreSQL (alineado con db-sqlite.js; excepción: promo_codes.expires_at es TIMESTAMPTZ aquí, TEXT en SQLite).
-- Ejecutar con: node scripts/runMigration.js

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('creator', 'fan')),
  handle TEXT UNIQUE,
  bio TEXT,
  category TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  mp_access_token TEXT,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text),
  avatar_color TEXT DEFAULT '#333333',
  social_instagram TEXT,
  social_facebook TEXT,
  social_tiktok TEXT,
  social_other TEXT,
  location TEXT,
  username TEXT UNIQUE,
  terms_accepted_at TEXT,
  privacy_accepted_at TEXT,
  terms_version TEXT,
  privacy_version TEXT,
  accepted_ip TEXT,
  reset_token TEXT,
  reset_token_expires TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  currency TEXT DEFAULT 'USD',
  description TEXT,
  features TEXT,
  is_featured INTEGER DEFAULT 0,
  mp_plan_id TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('photo', 'video', 'text')),
  file_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT,
  is_exclusive INTEGER DEFAULT 1,
  views INTEGER DEFAULT 0,
  text_body TEXT,
  background_style TEXT,
  scheduled_for TEXT,
  status TEXT DEFAULT 'published',
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  fan_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans (id),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled', 'expired')),
  mp_subscription_id TEXT,
  mp_payment_id TEXT,
  mp_preapproval_status TEXT,
  amount DOUBLE PRECISION,
  next_billing TEXT,
  promo_code TEXT,
  discount_percent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text),
  updated_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  subscription_id TEXT REFERENCES subscriptions (id),
  fan_id TEXT NOT NULL REFERENCES users (id),
  creator_id TEXT NOT NULL REFERENCES users (id),
  amount DOUBLE PRECISION NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  mp_payment_id TEXT,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE TABLE IF NOT EXISTS mercado_pago_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  public_key TEXT,
  mp_user_id TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS donations (
  id TEXT PRIMARY KEY,
  fan_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount DOUBLE PRECISION NOT NULL,
  currency_id TEXT DEFAULT 'MXN',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE TABLE IF NOT EXISTS content_likes (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content (id) ON DELETE CASCADE,
  fan_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text),
  UNIQUE (content_id, fan_id)
);

CREATE INDEX IF NOT EXISTS idx_content_likes_content ON content_likes (content_id);

CREATE TABLE IF NOT EXISTS stars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text),
  UNIQUE (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_stars_content ON stars (content_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  content TEXT NOT NULL,
  read_at TEXT DEFAULT NULL,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages (receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages (sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages (receiver_id, read_at);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_sender ON messages (receiver_id, sender_id);

CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  discount_percent INTEGER DEFAULT 100,
  duration_days INTEGER DEFAULT 7,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id TEXT PRIMARY KEY,
  promo_code_id TEXT NOT NULL REFERENCES promo_codes (id) ON DELETE CASCADE,
  fan_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text),
  UNIQUE (promo_code_id, fan_id)
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_creator ON promo_codes (creator_id);

CREATE INDEX IF NOT EXISTS idx_promo_codes_expires_at
  ON promo_codes (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS deleted_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  other_user_id TEXT NOT NULL,
  created_at TEXT DEFAULT ((now() AT TIME ZONE 'UTC')::text),
  UNIQUE (user_id, other_user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_fan ON subscriptions (fan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_creator ON subscriptions (creator_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_deleted_conversations_user ON deleted_conversations (user_id, other_user_id);
CREATE INDEX IF NOT EXISTS idx_users_id ON users (id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_active_fan_creator
  ON subscriptions (fan_id, creator_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at);
