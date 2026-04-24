-- BizPonzor: normalización segura de columnas de tiempo → timestamptz (PostgreSQL).
-- Idempotente: solo altera si information_schema indica que el tipo no es "timestamp with time zone".
-- Un solo bloque DO para compatibilidad con ejecución vía node-pg (una sentencia).
--
-- Obligatorias (created_at, updated_at, next_billing): USING … THEN NOW(); DROP DEFAULT + TYPE + SET DEFAULT NOW().
-- Opcionales (read_at, expires_at, deleted_at, etc.): USING … THEN NULL; DROP DEFAULT + TYPE; sin SET DEFAULT NOW().

DO $migration$
DECLARE
  r RECORD;
BEGIN
  /* ---------- users ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE users ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'updated_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE users ALTER COLUMN updated_at DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN updated_at TYPE timestamptz USING (
      CASE
        WHEN updated_at IS NULL OR updated_at::text = '' THEN NOW()
        ELSE updated_at::timestamptz
      END
    );
    ALTER TABLE users ALTER COLUMN updated_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'reset_token_expires'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE users ALTER COLUMN reset_token_expires DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN reset_token_expires TYPE timestamptz USING (
      CASE
        WHEN reset_token_expires IS NULL OR reset_token_expires::text = '' THEN NULL
        ELSE reset_token_expires::timestamptz
      END
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'terms_accepted_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE users ALTER COLUMN terms_accepted_at DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN terms_accepted_at TYPE timestamptz USING (
      CASE
        WHEN terms_accepted_at IS NULL OR terms_accepted_at::text = '' THEN NULL
        ELSE terms_accepted_at::timestamptz
      END
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'privacy_accepted_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE users ALTER COLUMN privacy_accepted_at DROP DEFAULT;
    ALTER TABLE users ALTER COLUMN privacy_accepted_at TYPE timestamptz USING (
      CASE
        WHEN privacy_accepted_at IS NULL OR privacy_accepted_at::text = '' THEN NULL
        ELSE privacy_accepted_at::timestamptz
      END
    );
  END IF;

  /* ---------- plans ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'plans' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE plans ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE plans ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE plans ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- content ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'content' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE content ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE content ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE content ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- subscriptions ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE subscriptions ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE subscriptions ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE subscriptions ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND column_name = 'updated_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE subscriptions ALTER COLUMN updated_at DROP DEFAULT;
    ALTER TABLE subscriptions ALTER COLUMN updated_at TYPE timestamptz USING (
      CASE
        WHEN updated_at IS NULL OR updated_at::text = '' THEN NOW()
        ELSE updated_at::timestamptz
      END
    );
    ALTER TABLE subscriptions ALTER COLUMN updated_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'subscriptions' AND column_name = 'next_billing'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE subscriptions ALTER COLUMN next_billing DROP DEFAULT;
    ALTER TABLE subscriptions ALTER COLUMN next_billing TYPE timestamptz USING (
      CASE
        WHEN next_billing IS NULL OR next_billing::text = '' THEN NOW()
        ELSE next_billing::timestamptz
      END
    );
  END IF;

  /* ---------- payments ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'payments' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE payments ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE payments ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE payments ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- mercado_pago_accounts ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'mercado_pago_accounts' AND column_name = 'expires_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE mercado_pago_accounts ALTER COLUMN expires_at DROP DEFAULT;
    ALTER TABLE mercado_pago_accounts ALTER COLUMN expires_at TYPE timestamptz USING (
      CASE
        WHEN expires_at IS NULL OR expires_at::text = '' THEN NULL
        ELSE expires_at::timestamptz
      END
    );
  END IF;

  /* ---------- donations ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'donations' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE donations ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE donations ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE donations ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- content_likes ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'content_likes' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE content_likes ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE content_likes ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE content_likes ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- stars ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'stars' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE stars ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE stars ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE stars ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- messages ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'messages' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE messages ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE messages ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE messages ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'messages' AND column_name = 'read_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE messages ALTER COLUMN read_at DROP DEFAULT;
    ALTER TABLE messages ALTER COLUMN read_at TYPE timestamptz USING (
      CASE
        WHEN read_at IS NULL OR read_at::text = '' THEN NULL
        ELSE read_at::timestamptz
      END
    );
  END IF;

  /* ---------- promo_codes ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'promo_codes' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE promo_codes ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE promo_codes ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE promo_codes ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'promo_codes' AND column_name = 'expires_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE promo_codes ALTER COLUMN expires_at DROP DEFAULT;
    ALTER TABLE promo_codes ALTER COLUMN expires_at TYPE timestamptz USING (
      CASE
        WHEN expires_at IS NULL OR expires_at::text = '' THEN NULL
        ELSE expires_at::timestamptz
      END
    );
  END IF;

  /* ---------- promo_redemptions ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'promo_redemptions' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE promo_redemptions ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE promo_redemptions ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE promo_redemptions ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- deleted_conversations ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'deleted_conversations' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE deleted_conversations ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE deleted_conversations ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE deleted_conversations ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- notifications ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'notifications' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE notifications ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE notifications ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE notifications ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'notifications' AND column_name = 'read_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE notifications ALTER COLUMN read_at DROP DEFAULT;
    ALTER TABLE notifications ALTER COLUMN read_at TYPE timestamptz USING (
      CASE
        WHEN read_at IS NULL OR read_at::text = '' THEN NULL
        ELSE read_at::timestamptz
      END
    );
  END IF;

  /* ---------- level_up_events ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'level_up_events' AND column_name = 'created_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE level_up_events ALTER COLUMN created_at DROP DEFAULT;
    ALTER TABLE level_up_events ALTER COLUMN created_at TYPE timestamptz USING (
      CASE
        WHEN created_at IS NULL OR created_at::text = '' THEN NOW()
        ELSE created_at::timestamptz
      END
    );
    ALTER TABLE level_up_events ALTER COLUMN created_at SET DEFAULT NOW();
  END IF;

  /* ---------- email_logs ---------- */
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'email_logs' AND column_name = 'sent_at'
      AND data_type <> 'timestamp with time zone'
  ) THEN
    ALTER TABLE email_logs ALTER COLUMN sent_at DROP DEFAULT;
    ALTER TABLE email_logs ALTER COLUMN sent_at TYPE timestamptz USING (
      CASE
        WHEN sent_at IS NULL OR sent_at::text = '' THEN NOW()
        ELSE sent_at::timestamptz
      END
    );
    ALTER TABLE email_logs ALTER COLUMN sent_at SET DEFAULT NOW();
  END IF;

  /* ---------- deleted_at (opcional, cualquier tabla del esquema actual) ---------- */
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = 'deleted_at'
      AND data_type <> 'timestamp with time zone'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN deleted_at DROP DEFAULT', r.table_name);
    EXECUTE format(
      $exec$
      ALTER TABLE %I ALTER COLUMN deleted_at TYPE timestamptz USING (
        CASE
          WHEN deleted_at IS NULL OR deleted_at::text = '' THEN NULL
          ELSE deleted_at::timestamptz
        END
      )
      $exec$,
      r.table_name
    );
  END LOOP;

END;
$migration$ LANGUAGE plpgsql;
