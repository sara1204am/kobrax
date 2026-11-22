-- F17 · F3-d — permiso nuevo `payment:waive_late` (exonerar interés moratorio). Aditiva e idempotente.
-- Sólo SUPER_ADMIN y ACCOUNT_ADMIN lo reciben (perdonar deuda es de alto riesgo, como `client:delete`); el resto lo concede desde Roles.
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "active", "updated_at")
VALUES (gen_random_uuid(), 'payment:waive_late', 'payment:waive_late', 'payments', 'EXECUTE', 'ACCOUNT', true, now())
ON CONFLICT ("code") DO NOTHING;

UPDATE "permissions" SET "risk" = 'HIGH'::"PermissionRisk", "reserved" = NULL, "requires" = '["payment:read"]'::jsonb WHERE "code" = 'payment:waive_late';

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payment:waive_late'
WHERE r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Regla desde f14_03: toda migración que cambie role_permissions sube policy_version.
UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;
