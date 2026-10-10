-- F4/13 · E3 — Perfil de ingreso del cliente: de qué vive y cuándo le llega el dinero.
--
-- ADITIVO: tabla y tipos nuevos; no toca nada existente. Todo opcional, una fila por cliente.
-- (Los `ADD VALUE` de `CatalogType` fueron migraciones aparte; acá solo se crean tipos nuevos, que sí pueden convivir
-- con su uso en la misma transacción.)

CREATE TYPE "income_cycle" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'SEASONAL', 'IRREGULAR');
CREATE TYPE "data_origin" AS ENUM ('MANUAL', 'DICTATION', 'IMPORT', 'SUGGESTION_ACCEPTED');

CREATE TABLE "client_income_profiles" (
  "id"                 TEXT NOT NULL,
  "account_id"         TEXT NOT NULL,
  "client_id"          TEXT NOT NULL,
  "income_source_code" TEXT,
  "occupation_code"    TEXT,
  "income_cycle"       "income_cycle",
  "income_day"         INTEGER,
  "notes"              TEXT,
  "origin"             "data_origin" NOT NULL DEFAULT 'MANUAL',
  "declared_by"        TEXT,
  "declared_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "client_income_profiles_pkey" PRIMARY KEY ("id"),
  -- El día solo tiene sentido con un ciclo, y dentro de 1–31 (la regla fina por ciclo vive en `shared`).
  CONSTRAINT "client_income_profiles_income_day_check" CHECK ("income_day" IS NULL OR ("income_day" BETWEEN 1 AND 31)),
  CONSTRAINT "client_income_profiles_day_needs_cycle_check" CHECK ("income_day" IS NULL OR "income_cycle" IS NOT NULL)
);

CREATE UNIQUE INDEX "client_income_profiles_client_id_key" ON "client_income_profiles"("client_id");
CREATE INDEX "client_income_profiles_account_id_idx" ON "client_income_profiles"("account_id");
CREATE INDEX "client_income_profiles_account_id_occupation_code_idx" ON "client_income_profiles"("account_id", "occupation_code");

ALTER TABLE "client_income_profiles"
  ADD CONSTRAINT "client_income_profiles_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_income_profiles"
  ADD CONSTRAINT "client_income_profiles_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: igual que el resto de las tablas operativas (ver prisma/rls/001_enable_rls.sql).
ALTER TABLE "client_income_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_income_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "client_income_profiles";
CREATE POLICY tenant_isolation ON "client_income_profiles"
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "client_income_profiles" TO kobrax_app;
  END IF;
END $$;
