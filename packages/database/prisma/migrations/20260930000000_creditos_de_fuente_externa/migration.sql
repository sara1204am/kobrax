-- Créditos de una fuente externa (PSF) — F4/06 · PSF, fase 2. Contrato en el informe de brecha
-- «Créditos importados (PSF) — análisis de brecha» y su revisión final (D1–D9).
--
-- Aditiva salvo un punto: `credits.code` deja de ser único (D1). La identidad de una operación externa
-- pasa a `(account_id, external_source, external_id)`, con un índice único parcial al final.
--
-- ⚠️ Esta migración NO escribe policies de RLS. Las tres tablas nuevas quedan aisladas por tenant
-- al volver a correr `prisma/rls/001_enable_rls.sql` (ya las lista).

-- CreateEnum
CREATE TYPE "credit_data_origin" AS ENUM ('MANUAL', 'QUICK_BATCH', 'IMPORT', 'API');

-- CreateEnum
CREATE TYPE "external_sync_status" AS ENUM ('PRESENT', 'ABSENT');

-- CreateEnum
CREATE TYPE "payment_channel" AS ENUM ('KOBRAX_COLLECTED', 'EXTERNAL_CONFIRMED');

-- DropIndex
DROP INDEX "credits_account_id_code_key";

-- AlterTable
ALTER TABLE "client_import_runs" ADD COLUMN     "advisor_code" TEXT,
ADD COLUMN     "external_source" TEXT,
ADD COLUMN     "report_as_of" DATE;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "link_review_pending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "max_days_past_due_external" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_debt_external" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "credits" ADD COLUMN     "absent_since" DATE,
ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "external_source" TEXT,
ADD COLUMN     "last_seen_run_id" TEXT,
ADD COLUMN     "origin" "credit_data_origin" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "reported_as_of" DATE,
ADD COLUMN     "sync_status" "external_sync_status";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "channel" "payment_channel" NOT NULL DEFAULT 'KOBRAX_COLLECTED',
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "credit_external_snapshots" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "external_source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "sync_status" "external_sync_status" NOT NULL,
    "reported_as_of" DATE,
    "reported_balance" DECIMAL(14,2),
    "reported_days_past_due" INTEGER,
    "reported_status" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_external_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_external_keys" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "external_source" TEXT NOT NULL,
    "key_type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "confirmed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "client_external_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_advisor_links" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "external_source" TEXT NOT NULL,
    "advisor_code" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "external_advisor_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_external_snapshots_account_id_credit_id_created_at_idx" ON "credit_external_snapshots"("account_id", "credit_id", "created_at");

-- CreateIndex
CREATE INDEX "credit_external_snapshots_account_id_run_id_idx" ON "credit_external_snapshots"("account_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "credit_external_snapshots_credit_id_run_id_key" ON "credit_external_snapshots"("credit_id", "run_id");

-- CreateIndex
CREATE INDEX "client_external_keys_account_id_client_id_idx" ON "client_external_keys"("account_id", "client_id");

-- CreateIndex
CREATE INDEX "client_external_keys_deleted_at_idx" ON "client_external_keys"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_external_keys_account_id_external_source_key_type_ke_key" ON "client_external_keys"("account_id", "external_source", "key_type", "key");

-- CreateIndex
CREATE INDEX "external_advisor_links_account_id_user_id_idx" ON "external_advisor_links"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "external_advisor_links_deleted_at_idx" ON "external_advisor_links"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "external_advisor_links_account_id_external_source_advisor_c_key" ON "external_advisor_links"("account_id", "external_source", "advisor_code");

-- CreateIndex
CREATE INDEX "client_import_runs_account_id_external_source_scope_report__idx" ON "client_import_runs"("account_id", "external_source", "scope", "report_as_of");

-- CreateIndex
CREATE INDEX "clients_account_id_link_review_pending_idx" ON "clients"("account_id", "link_review_pending");

-- CreateIndex
CREATE INDEX "credits_account_id_code_idx" ON "credits"("account_id", "code");

-- CreateIndex
CREATE INDEX "credits_account_id_external_source_sync_status_idx" ON "credits"("account_id", "external_source", "sync_status");

-- AddForeignKey
ALTER TABLE "credit_external_snapshots" ADD CONSTRAINT "credit_external_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_external_snapshots" ADD CONSTRAINT "credit_external_snapshots_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_external_keys" ADD CONSTRAINT "client_external_keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_external_keys" ADD CONSTRAINT "client_external_keys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_advisor_links" ADD CONSTRAINT "external_advisor_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Identidad de la operación externa (D1) ────────────────────────────────────────────────────
-- Parcial: los créditos de Kobrax no tienen `external_id`. Incluye los borrados a propósito — igual
-- que el unique de `code` que reemplaza: una operación borrada sigue ocupando su número y el
-- importador la reporta en vez de crear otra.
CREATE UNIQUE INDEX "credits_external_identity_key"
    ON "credits"("account_id", "external_source", "external_id")
    WHERE "external_id" IS NOT NULL;

-- ─── Backfill ───────────────────────────────────────────────────────────────────────────────────
-- El origen salía de `metadata.origin`; un valor ausente o desconocido se leía como manual
-- (`readCreditMetadata`), y eso mismo es lo que se guarda.
UPDATE "credits"
SET "origin" = CASE "metadata"->>'origin'
        WHEN 'import'      THEN 'IMPORT'
        WHEN 'api'         THEN 'API'
        WHEN 'quick_batch' THEN 'QUICK_BATCH'
        ELSE 'MANUAL'
    END::"credit_data_origin";

-- Hasta hoy la única fuente de archivos es PSF. Su nº de operación es el `code` que el importador
-- usaba de llave, así que el backfill no puede chocar: venía de un unique por cuenta.
UPDATE "credits"
SET "external_source"  = CASE "origin" WHEN 'IMPORT' THEN 'PSF' ELSE 'API' END,
    "external_id"      = "code",
    "last_seen_run_id" = "metadata"->>'importRunId'
WHERE "origin" IN ('IMPORT', 'API');

/*
 * ¿Vino en el último reporte de su alcance? Ausente = hubo, después de la corrida que lo tocó por
 * última vez, otra corrida del MISMO alcance que no lo trajo. Mirar la última corrida de la cuenta
 * a secas marcaría ausentes a todos los créditos de los otros asesores (D8).
 *
 * `absent_since` queda NULL: la fecha exacta no se guardó nunca y no se inventa. Un importado anterior
 * a la Fase 4 (sin `importRunId`) queda PRESENT: la próxima corrida de su alcance lo resuelve.
 */
UPDATE "credits" c
SET "sync_status" = CASE WHEN EXISTS (
        SELECT 1
        FROM "client_import_runs" own
        JOIN "client_import_runs" later
          ON later."account_id" = own."account_id"
         AND later."template" IS NOT NULL
         AND later."status" = 'DONE'
         AND later."scope" IS NOT DISTINCT FROM own."scope"
         AND later."created_at" > own."created_at"
        WHERE own."id" = c."last_seen_run_id"
    ) THEN 'ABSENT' ELSE 'PRESENT' END::"external_sync_status"
WHERE c."origin" = 'IMPORT';

UPDATE "client_import_runs" SET "external_source" = 'PSF' WHERE "template" IS NOT NULL;

-- Un crédito de Kobrax no tiene nada de fuente externa. Va después del backfill.
ALTER TABLE "credits" ADD CONSTRAINT "credits_external_fields_only_if_external"
    CHECK ("origin" IN ('IMPORT', 'API')
           OR ("external_source" IS NULL AND "external_id" IS NULL AND "sync_status" IS NULL));

-- ─── Totales del cliente por fuente (D7) ────────────────────────────────────────────────────────
-- La misma función del trigger de `20260814210000_denormalize_portfolio_totals`, con la parte
-- externa aparte: el saldo y la mora de PSF son reportados, no calculados, y no se mezclan en
-- silencio. `total_debt` sigue siendo el total (la cartera ordena por él).
CREATE OR REPLACE FUNCTION portfolio_totals_recalc(target_client_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE clients c
  SET total_debt                 = t.debt,
      max_days_past_due          = t.dpd,
      credit_count               = t.n,
      total_debt_external        = t.debt_ext,
      max_days_past_due_external = t.dpd_ext
  FROM (
    SELECT COALESCE(SUM(outstanding_balance), 0)::numeric(14,2)                                      AS debt,
           COALESCE(MAX(days_past_due), 0)::int                                                      AS dpd,
           COUNT(*)::int                                                                             AS n,
           COALESCE(SUM(outstanding_balance) FILTER (WHERE origin IN ('IMPORT', 'API')), 0)::numeric(14,2) AS debt_ext,
           COALESCE(MAX(days_past_due) FILTER (WHERE origin IN ('IMPORT', 'API')), 0)::int                 AS dpd_ext
    FROM credits
    WHERE client_id = target_client_id AND deleted_at IS NULL
  ) t
  WHERE c.id = target_client_id
    AND (c.total_debt, c.max_days_past_due, c.credit_count, c.total_debt_external, c.max_days_past_due_external)
        IS DISTINCT FROM (t.debt, t.dpd, t.n, t.debt_ext, t.dpd_ext);
$$;

-- El origen también mueve los números ahora: se suma a las columnas que disparan el recálculo.
DROP TRIGGER IF EXISTS credits_totals_upd ON credits;
CREATE TRIGGER credits_totals_upd
  AFTER UPDATE OF outstanding_balance, days_past_due, client_id, deleted_at, origin ON credits
  FOR EACH ROW
  WHEN (
    OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance
    OR OLD.days_past_due IS DISTINCT FROM NEW.days_past_due
    OR OLD.client_id IS DISTINCT FROM NEW.client_id
    OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
    OR OLD.origin IS DISTINCT FROM NEW.origin
  )
  EXECUTE FUNCTION credits_touch_client_totals();

-- Backfill de la parte externa, en una sola pasada. El backfill de `origin` de arriba corrió con el
-- trigger anterior (que no miraba `origin`), así que las columnas externas se llenan acá.
UPDATE clients c
SET total_debt_external        = t.debt_ext,
    max_days_past_due_external = t.dpd_ext
FROM (
  SELECT cl.id,
         COALESCE(SUM(cr.outstanding_balance) FILTER (WHERE cr.origin IN ('IMPORT', 'API')), 0)::numeric(14,2) AS debt_ext,
         COALESCE(MAX(cr.days_past_due) FILTER (WHERE cr.origin IN ('IMPORT', 'API')), 0)::int                 AS dpd_ext
  FROM clients cl
  LEFT JOIN credits cr ON cr.client_id = cl.id AND cr.deleted_at IS NULL
  GROUP BY cl.id
) t
WHERE c.id = t.id;
