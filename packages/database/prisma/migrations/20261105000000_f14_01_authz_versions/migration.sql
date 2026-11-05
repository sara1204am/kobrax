-- F14 · F1 · Sesiones y aislamiento. SOLO ADITIVA (se puede dejar de usar sin deshacer nada).
--   · user_accounts.authz_version  → versión de la membresía; viaja en el JWT como `av` (H-2).
--   · platform_settings            → `policy_version` global (una fila) → claim `pv`.
--   · authz_version_outbox         → outbox transaccional DB→Redis (RLS por tenant en rls/001).
--   · clients.created_by           → trazabilidad (NO es dueño, H-7); evita que el creador pierda de vista su cliente sin crédito (N-12 interino).

ALTER TABLE "user_accounts" ADD COLUMN "authz_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "policy_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_settings_single_row" CHECK ("id" = 1)
);
INSERT INTO "platform_settings" ("id", "policy_version") VALUES (1, 1) ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "authz_version_outbox" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "authz_version_outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "authz_version_outbox_account_id_user_id_idx" ON "authz_version_outbox"("account_id", "user_id");
CREATE INDEX "authz_version_outbox_pending_idx" ON "authz_version_outbox"("created_at") WHERE "processed_at" IS NULL;

ALTER TABLE "clients" ADD COLUMN "created_by" TEXT;

-- Permiso nuevo: cerrar las sesiones de un miembro. Sólo datos, idempotente. Espejo de `ROLE_PERMISSIONS` (shared):
-- lo tienen los roles que ya traen todos los permisos (ACCOUNT_ADMIN y SUPER_ADMIN).
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'user:sessions:revoke', 'user:sessions:revoke', 'users', 'EXECUTE', 'ACCOUNT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'user:sessions:revoke'
WHERE r."name" IN ('ACCOUNT_ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
