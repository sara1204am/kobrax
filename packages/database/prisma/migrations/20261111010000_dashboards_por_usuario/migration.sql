-- Tableros por persona: cada usuario tiene SUS tableros (pestañas del dashboard), no uno compartido por la cuenta.
-- Los existentes pasan a ser de quien los creó; los que no tienen creador (datos de prueba) se dan de baja (borrado suave).
ALTER TABLE "dashboards" ADD COLUMN "owner_user_id" TEXT;

UPDATE "dashboards" SET "owner_user_id" = "created_by" WHERE "created_by" IS NOT NULL;
UPDATE "dashboards" SET "deleted_at" = NOW(), "is_default" = false WHERE "owner_user_id" IS NULL AND "deleted_at" IS NULL;

CREATE INDEX "dashboards_account_id_owner_user_id_idx" ON "dashboards"("account_id", "owner_user_id");
