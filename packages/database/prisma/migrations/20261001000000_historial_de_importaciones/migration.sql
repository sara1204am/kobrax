-- Historial de importaciones de cartera: cada corrida guarda su documento y cada movimiento.
--
-- Aditiva. La tabla nueva lleva RLS por tenant como las demás operativas (también sumada a
-- `prisma/rls/001_enable_rls.sql`, que es de donde se reaplica).
--
-- ⚠️ `prisma migrate diff` también propone `DROP INDEX "idx_payments_analytics"`: es un índice
-- creado a mano para analytics que no está en el schema. No se toca.

-- CreateEnum
CREATE TYPE "import_run_item_action" AS ENUM ('CREATED', 'UPDATED', 'REAPPEARED', 'SET_CURRENT', 'ABSENT', 'REJECTED');

-- AlterTable
ALTER TABLE "client_import_runs" ADD COLUMN     "credits_absent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "credits_reappeared" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "file_key" TEXT,
ADD COLUMN     "file_mime" TEXT,
ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "file_size" INTEGER,
ADD COLUMN     "items_complete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rows_ignored" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "client_import_run_items" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "action" "import_run_item_action" NOT NULL,
    "credit_id" TEXT,
    "client_id" TEXT,
    "external_id" TEXT,
    "client_name" TEXT,
    "row_number" INTEGER,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_import_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_import_run_items_account_id_run_id_action_idx" ON "client_import_run_items"("account_id", "run_id", "action");

-- CreateIndex
CREATE INDEX "client_import_run_items_account_id_credit_id_idx" ON "client_import_run_items"("account_id", "credit_id");

-- CreateIndex
CREATE INDEX "client_import_runs_account_id_source_created_at_idx" ON "client_import_runs"("account_id", "source", "created_at");

-- AddForeignKey
ALTER TABLE "client_import_run_items" ADD CONSTRAINT "client_import_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "client_import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: igual que el resto de las tablas operativas (ver prisma/rls/001_enable_rls.sql).
ALTER TABLE "client_import_run_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_import_run_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "client_import_run_items";
CREATE POLICY tenant_isolation ON "client_import_run_items"
  USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "client_import_run_items" TO kobrax_app;
  END IF;
END $$;

-- ── Relleno de las corridas de cartera que ya existían ─────────────────────────
-- Lo que se sabe de ellas está en la auditoría (el resumen de la corrida y los eventos de cada
-- operación) y en los snapshots. Lo que nunca se guardó —cuáles se pusieron al día, qué filas se
-- rechazaron y el archivo— no se inventa: la corrida queda con `items_complete = false`.

-- Los números que faltaban, del resumen que la corrida dejó en la auditoría.
UPDATE client_import_runs r
SET credits_absent     = COALESCE((a.after->>'absent')::int, 0),
    credits_reappeared = COALESCE((a.after->>'reappeared')::int, 0),
    rows_ignored       = COALESCE((a.after->>'ignored')::int, 0)
FROM audit_logs a
WHERE r.source = 'portfolio' AND a.entity = 'portfolio_import' AND a.action = 'IMPORT' AND a.entity_id = r.id;

-- Nuevas, reaparecidas y ausentes: un evento de auditoría por operación, con su corrida.
INSERT INTO client_import_run_items (id, account_id, run_id, action, credit_id, client_id, external_id, client_name, before, after, created_at)
SELECT gen_random_uuid()::text, r.account_id, r.id,
       CASE a.action WHEN 'EXTERNAL_APPEARED' THEN 'CREATED'
                     WHEN 'EXTERNAL_REAPPEARED' THEN 'REAPPEARED'
                     ELSE 'ABSENT' END::"import_run_item_action",
       c.id, c.client_id, a.after->>'externalId',
       NULLIF(trim(concat_ws(' ', cl.business_name, cl.last_name, cl.first_name)), ''),
       a.before,
       CASE WHEN a.action = 'EXTERNAL_ABSENT' THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
              'outstandingBalance', a.after->'outstandingBalance',
              'daysPastDue', a.after->'daysPastDue',
              'status', a.after->'status')) END,
       a.created_at
FROM audit_logs a
JOIN client_import_runs r ON r.id = a.after->>'runId' AND r.source = 'portfolio'
LEFT JOIN credits c ON c.id = a.entity_id
LEFT JOIN clients cl ON cl.id = c.client_id
WHERE a.entity = 'credit' AND a.action IN ('EXTERNAL_APPEARED', 'EXTERNAL_REAPPEARED', 'EXTERNAL_ABSENT');

-- Actualizadas: vinieron en el reporte y ya existían. El «antes» es lo reportado en la corrida anterior.
INSERT INTO client_import_run_items (id, account_id, run_id, action, credit_id, client_id, external_id, client_name, before, after, created_at)
SELECT gen_random_uuid()::text, s.account_id, s.run_id, 'UPDATED'::"import_run_item_action",
       s.credit_id, c.client_id, s.external_id,
       NULLIF(trim(concat_ws(' ', cl.business_name, cl.last_name, cl.first_name)), ''),
       CASE WHEN s.prev_balance IS NULL AND s.prev_dpd IS NULL THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object('outstandingBalance', s.prev_balance, 'daysPastDue', s.prev_dpd, 'status', s.prev_status)) END,
       jsonb_strip_nulls(jsonb_build_object('outstandingBalance', s.reported_balance, 'daysPastDue', s.reported_days_past_due, 'status', s.reported_status)),
       s.created_at
FROM (
  SELECT sn.*,
         LAG(sn.reported_balance)       OVER w AS prev_balance,
         LAG(sn.reported_days_past_due) OVER w AS prev_dpd,
         LAG(sn.reported_status)        OVER w AS prev_status
  FROM credit_external_snapshots sn
  WINDOW w AS (PARTITION BY sn.credit_id ORDER BY sn.created_at)
) s
JOIN client_import_runs r ON r.id = s.run_id AND r.source = 'portfolio'
LEFT JOIN credits c ON c.id = s.credit_id
LEFT JOIN clients cl ON cl.id = c.client_id
WHERE s.sync_status = 'PRESENT'
  AND NOT EXISTS (
    SELECT 1 FROM client_import_run_items i
    WHERE i.run_id = s.run_id AND i.credit_id = s.credit_id AND i.action IN ('CREATED', 'REAPPEARED'));
