-- CreateEnum
CREATE TYPE "AgendaItemType" AS ENUM ('CALL', 'VISIT', 'WHATSAPP', 'REMINDER', 'PROMISE_TO_PAY');

-- CreateEnum
CREATE TYPE "AgendaItemStatus" AS ENUM ('SCHEDULED', 'EXECUTED', 'CANCELLED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "ScheduleTimeMode" AS ENUM ('FIXED', 'LAPSE', 'RANGE');

-- CreateEnum
CREATE TYPE "CatalogType" AS ENUM ('PAYMENT_METHOD', 'BANK', 'EXPECTED_RESULT', 'PRIORITY', 'ADDRESS_TYPE', 'PHONE_TYPE', 'CANCEL_REASON', 'RESCHEDULE_REASON', 'REMINDER_CATEGORY', 'CAMPAIGN', 'CURRENCY');

-- CreateTable
CREATE TABLE "agenda_items" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "assignee_id" TEXT NOT NULL,
    "type" "AgendaItemType" NOT NULL,
    "status" "AgendaItemStatus" NOT NULL DEFAULT 'SCHEDULED',
    "priority_code" TEXT,
    "expected_result_code" TEXT,
    "scheduled_date" DATE NOT NULL,
    "time_mode" "ScheduleTimeMode" NOT NULL DEFAULT 'FIXED',
    "scheduled_time" TEXT,
    "time_slot" TEXT,
    "observations" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "result_activity_id" TEXT,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "catalog" "CatalogType" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agenda_items_account_id_assignee_id_scheduled_date_idx" ON "agenda_items"("account_id", "assignee_id", "scheduled_date");

-- CreateIndex
CREATE INDEX "agenda_items_account_id_case_id_idx" ON "agenda_items"("account_id", "case_id");

-- CreateIndex
CREATE INDEX "agenda_items_account_id_status_idx" ON "agenda_items"("account_id", "status");

-- CreateIndex
CREATE INDEX "agenda_items_deleted_at_idx" ON "agenda_items"("deleted_at");

-- CreateIndex
CREATE INDEX "catalog_items_account_id_catalog_is_active_idx" ON "catalog_items"("account_id", "catalog", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_account_id_catalog_code_key" ON "catalog_items"("account_id", "catalog", "code");

-- AddForeignKey
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS por tenant (mismo patrón que el resto de tablas operativas; app_current_account() ya existe).
ALTER TABLE "agenda_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agenda_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "agenda_items";
CREATE POLICY tenant_isolation ON "agenda_items"
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());
GRANT SELECT, INSERT, UPDATE, DELETE ON "agenda_items" TO kobrax_app;

ALTER TABLE "catalog_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalog_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "catalog_items";
CREATE POLICY tenant_isolation ON "catalog_items"
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());
GRANT SELECT, INSERT, UPDATE, DELETE ON "catalog_items" TO kobrax_app;
