-- BizPonzor: limpieza de timestamps opcionales mal rellenados (p. ej. NOW() por error en migración 001).
-- Idempotente: repetir es seguro; solo anula valores sospechosos (read_at / expires_at / deleted_at ≈ created_at en < 5 s).

DO $cleanup$
DECLARE
  n bigint;
  r RECORD;
BEGIN
  /* ---------- messages.read_at ---------- */
  UPDATE messages
  SET read_at = NULL
  WHERE read_at IS NOT NULL
    AND created_at IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM (read_at::timestamptz - created_at::timestamptz))) < 5;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[002] messages.read_at: % filas puestas en NULL (sospechosas vs created_at)', n;

  /* ---------- notifications.read_at ---------- */
  UPDATE notifications
  SET read_at = NULL
  WHERE read_at IS NOT NULL
    AND created_at IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM (read_at::timestamptz - created_at::timestamptz))) < 5;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[002] notifications.read_at: % filas puestas en NULL (sospechosas vs created_at)', n;

  /* ---------- promo_codes.expires_at ---------- */
  UPDATE promo_codes
  SET expires_at = NULL
  WHERE expires_at IS NOT NULL
    AND created_at IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM (expires_at::timestamptz - created_at::timestamptz))) < 5;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '[002] promo_codes.expires_at: % filas puestas en NULL (sospechosas vs created_at)', n;

  /* ---------- mercado_pago_accounts.expires_at (solo si la columna admite NULL) ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'mercado_pago_accounts'
      AND column_name = 'expires_at'
      AND is_nullable = 'YES'
  ) THEN
    UPDATE mercado_pago_accounts m
    SET expires_at = NULL
    FROM users u
    WHERE m.user_id = u.id
      AND m.expires_at IS NOT NULL
      AND u.created_at IS NOT NULL
      AND ABS(EXTRACT(EPOCH FROM (m.expires_at::timestamptz - u.created_at::timestamptz))) < 5;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '[002] mercado_pago_accounts.expires_at: % filas puestas en NULL (sospechosas vs users.created_at)', n;
  ELSE
    RAISE NOTICE '[002] mercado_pago_accounts.expires_at: omitido (NOT NULL o sin columna)';
  END IF;

  /* ---------- deleted_at (tablas que tengan created_at en el mismo esquema) ---------- */
  FOR r IN
    SELECT d.table_name::text AS tbl
    FROM information_schema.columns d
    INNER JOIN information_schema.columns c
      ON d.table_schema = c.table_schema
      AND d.table_name = c.table_name
    WHERE d.table_schema = current_schema()
      AND d.column_name = 'deleted_at'
      AND c.column_name = 'created_at'
  LOOP
    EXECUTE format(
      $q$
      UPDATE %I SET deleted_at = NULL
      WHERE deleted_at IS NOT NULL
        AND created_at IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (deleted_at::timestamptz - created_at::timestamptz))) < 5
      $q$,
      r.tbl
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE NOTICE '[002] %.deleted_at: % filas puestas en NULL (sospechosas vs created_at)', r.tbl, n;
  END LOOP;

END;
$cleanup$ LANGUAGE plpgsql;
