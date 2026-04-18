-- Opcional: alinear tipo de promo_codes.expires_at con comparaciones en PostgreSQL.
-- Ejecutar manualmente en Railway/psql DESPUÉS de validar datos (ver notas abajo).
--
-- Notas:
-- 1) Todos los valores no nulos en expires_at deben ser fechas parseables por PostgreSQL
--    (p. ej. ISO 8601). Cadenas vacías o basura harán fallar el USING.
-- 2) Antes de migrar, inspeccionar:
--    SELECT id, expires_at FROM promo_codes
--    WHERE expires_at IS NOT NULL AND expires_at !~ '^\d{4}-\d{2}-\d{2}';
--    (ajustar el patrón según tu formato real).
-- 3) Tras el cambio, la app puede seguir enviando ISO como texto; el driver devuelve Date o string
--    según configuración. Ajustar el frontend si hace falta.

BEGIN;

ALTER TABLE promo_codes
  ALTER COLUMN expires_at TYPE TIMESTAMPTZ
  USING (
    CASE
      WHEN expires_at IS NULL THEN NULL
      ELSE expires_at::timestamptz
    END
  );

CREATE INDEX IF NOT EXISTS idx_promo_codes_expires_at
  ON promo_codes (expires_at)
  WHERE expires_at IS NOT NULL;

COMMIT;
