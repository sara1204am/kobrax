-- Refactor de Cuenta · F7 — solicitudes de la cuenta a Kobrax (cambio de plan, baja).
CREATE TYPE "AccountRequestType" AS ENUM ('PLAN_CHANGE', 'CLOSURE');
CREATE TYPE "AccountRequestStatus" AS ENUM ('PENDING', 'HANDLED', 'REJECTED');

CREATE TABLE "account_requests" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "AccountRequestType" NOT NULL,
    "status" "AccountRequestStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "requested_by" TEXT NOT NULL,
    "handled_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handled_at" TIMESTAMP(3),
    CONSTRAINT "account_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_requests_account_id_status_idx" ON "account_requests"("account_id", "status");

-- Una sola pendiente por tipo y cuenta: la guarda real contra el doble clic y contra dos administradores a la vez.
CREATE UNIQUE INDEX "account_requests_one_pending_key" ON "account_requests" ("account_id", "type") WHERE "status" = 'PENDING';

ALTER TABLE "account_requests" ADD CONSTRAINT "account_requests_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS por tenant (mismo patrón que `client_import_runs`; `app_current_account()` ya existe).
ALTER TABLE "account_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_requests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "account_requests";
CREATE POLICY tenant_isolation ON "account_requests"
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());
