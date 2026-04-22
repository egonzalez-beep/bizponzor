-- Registro de correos transaccionales (Resend). Idempotente en PostgreSQL.

CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::text)
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user ON email_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_type ON email_logs (user_id, type);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent ON email_logs (sent_at DESC);
