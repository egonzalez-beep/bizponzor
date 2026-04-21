-- PostgreSQL: fechas de subscriptions como timestamptz (evita text vs timestamptz en comparaciones).
-- Ejecutar en producción si la tabla ya existía con TEXT, o confiar en la migración al arranque en server.

ALTER TABLE subscriptions
  ALTER COLUMN next_billing TYPE timestamptz
  USING (
    CASE
      WHEN next_billing IS NULL OR length(trim(next_billing::text)) = 0 THEN NULL
      ELSE next_billing::timestamptz
    END
  );

ALTER TABLE subscriptions
  ALTER COLUMN created_at TYPE timestamptz
  USING (
    CASE
      WHEN created_at IS NULL OR length(trim(created_at::text)) = 0 THEN CURRENT_TIMESTAMP
      ELSE created_at::timestamptz
    END
  );

ALTER TABLE subscriptions
  ALTER COLUMN updated_at TYPE timestamptz
  USING (
    CASE
      WHEN updated_at IS NULL OR length(trim(updated_at::text)) = 0 THEN CURRENT_TIMESTAMP
      ELSE updated_at::timestamptz
    END
  );
