-- Visibilidad en Descubrir / feed de descubrimiento (creadores).
-- Idempotente en PostgreSQL. Ejecutar en producción si aún no está la columna:
--   psql $DATABASE_URL -f migrations/add-users-is-public.sql
-- O añadir la sentencia en tu pipeline de migraciones.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT TRUE;
