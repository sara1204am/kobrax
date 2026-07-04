-- F4 Fase 5 · Importación masiva/reconciliación de clientes.
CREATE TABLE "client_import_runs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "soft_deleted" INTEGER NOT NULL DEFAULT 0,
    "needs_review" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "client_import_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_import_runs_account_id_status_idx" ON "client_import_runs"("account_id", "status");
CREATE INDEX "client_import_runs_account_id_file_hash_idx" ON "client_import_runs"("account_id", "file_hash");

-- RLS por tenant (mismo patrón que el resto de tablas operativas; app_current_account() ya existe).
ALTER TABLE "client_import_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_import_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "client_import_runs";
CREATE POLICY tenant_isolation ON "client_import_runs"
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());
GRANT SELECT, INSERT, UPDATE, DELETE ON "client_import_runs" TO kobrax_app;
