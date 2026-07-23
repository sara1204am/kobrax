-- F10 · Fundación del import de CARTERA.
-- N4: `code` (No.Credito) es la llave de match del extracto → único por tenant.
--     Postgres permite múltiples NULL en un índice único → los créditos manuales sin code no chocan.
CREATE UNIQUE INDEX "credits_account_id_code_key" ON "credits"("account_id", "code");

-- N5: la tabla de corridas de import se reusa para cartera (columnas nullable = import de clientes legacy).
ALTER TABLE "client_import_runs"
  ADD COLUMN "template" TEXT,
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "credits_created" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "credits_updated" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "credits_set_current" INTEGER NOT NULL DEFAULT 0;
