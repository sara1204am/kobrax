-- F14 · F2 — permisos nuevos `client:create`, `credit:create` y `client:delete` (D-3).
-- Aditiva. `client:create`/`credit:create` los reciben quienes hoy ya tienen `client:write`/`credit:write` (sin cambio de comportamiento);
-- `client:delete` sólo ACCOUNT_ADMIN y SUPER_ADMIN (H-12): supervisor, cobrador y gerente dejan de borrar clientes.
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "active", "updated_at")
VALUES
  (gen_random_uuid(), 'client:create', 'client:create', 'clients', 'CREATE', 'ACCOUNT', true, now()),
  (gen_random_uuid(), 'client:delete', 'client:delete', 'clients', 'DELETE', 'ACCOUNT', true, now()),
  (gen_random_uuid(), 'credit:create', 'credit:create', 'credits', 'CREATE', 'ACCOUNT', true, now())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN ('client:create', 'credit:create')
WHERE r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'MANAGER', 'COLLECTOR')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'client:delete'
WHERE r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Regla desde f14_03: toda migración que cambie role_permissions sube policy_version (cada sesión viva recibe un AUTHZ_STALE y renueva).
UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;
