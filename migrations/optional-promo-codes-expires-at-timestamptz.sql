-- LEGACY: solo bases PostgreSQL creadas ANTES de que migrations/init.sql definiera
-- promo_codes.expires_at como TIMESTAMPTZ.
--
-- Instalaciones nuevas: ejecutar solo node scripts/runMigration.js (init.sql ya incluye
-- TIMESTAMPTZ + índice idx_promo_codes_expires_at).
--
-- Si tu producción ya aplicó este ALTER manualmente, no vuelvas a ejecutar este archivo.

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
