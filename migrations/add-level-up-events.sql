-- Eventos Level Up (tracking CTA). Idempotente en PostgreSQL.

CREATE TABLE IF NOT EXISTS level_up_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE INDEX IF NOT EXISTS idx_level_up_events_user ON level_up_events (user_id);
CREATE INDEX IF NOT EXISTS idx_level_up_events_created ON level_up_events (created_at DESC);
