-- F14 · F2 (H-3, D-4) — el gerente invita (con la política `member.invite`) y el supervisor ve las personas de su oficina.
-- Aditiva: sólo filas en role_permissions. El servidor acota por alcance y jerarquía (rol destino de tier inferior, oficina del subárbol).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('user:invite', 'role:read')
WHERE r."name" = 'MANAGER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'user:read'
WHERE r."name" = 'SUPERVISOR'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Regla desde f14_03: toda migración que cambie role_permissions sube policy_version.
UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;
