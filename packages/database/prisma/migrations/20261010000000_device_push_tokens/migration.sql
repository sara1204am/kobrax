-- F10 · Push remoto (FCM, Android). Una fila por instalación de la app y usuario: el token de registro de FCM con el
-- que la API le avisa a ese teléfono. Varios dispositivos por usuario; un mismo teléfono con otro usuario es otra fila.
--
-- ADITIVO: no toca nada existente. Sin credenciales de Firebase en el servidor, la tabla se llena igual y el envío
-- queda apagado (ver `PushService`).

CREATE TABLE "device_push_tokens" (
  "id"              TEXT NOT NULL,
  "account_id"      TEXT NOT NULL,
  "user_id"         TEXT NOT NULL,
  -- Identidad estable de la instalación (la genera la app): permite renovar el token sin duplicar filas.
  "installation_id" TEXT NOT NULL,
  "token"           TEXT NOT NULL,
  "platform"        TEXT NOT NULL DEFAULT 'android',
  "app_version"     TEXT,
  "device_name"     TEXT,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  -- Fallos consecutivos de envío y el último motivo, para diagnóstico y limpieza de tokens muertos.
  "failure_count"   INTEGER NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "last_seen_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_pushed_at"  TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "device_push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_push_tokens_account_id_user_id_installation_id_key"
  ON "device_push_tokens"("account_id", "user_id", "installation_id");
CREATE INDEX "device_push_tokens_account_id_user_id_is_active_idx"
  ON "device_push_tokens"("account_id", "user_id", "is_active");
CREATE INDEX "device_push_tokens_token_idx" ON "device_push_tokens"("token");

ALTER TABLE "device_push_tokens"
  ADD CONSTRAINT "device_push_tokens_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: igual que el resto de las tablas operativas (ver prisma/rls/001_enable_rls.sql).
ALTER TABLE "device_push_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_push_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "device_push_tokens";
CREATE POLICY tenant_isolation ON "device_push_tokens"
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "device_push_tokens" TO kobrax_app;
  END IF;
END $$;
