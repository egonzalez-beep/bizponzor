-- Baja al fin de periodo (Mercado Pago PreApproval). Idempotente en PostgreSQL.
-- Aplicar en producción si la tabla ya existía sin esta columna.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE;
