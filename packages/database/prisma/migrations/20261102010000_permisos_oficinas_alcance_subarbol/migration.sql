-- F13 · P2 — permisos de oficinas y alcance por subárbol (R12, R13). Sólo datos: no cambia el schema. Idempotente.
-- Espejo de `ROLE_PERMISSIONS` (shared) y de `seed.ts`.
--
-- 1 · Permisos nuevos:
--     · office:read          — ver el árbol de oficinas. Lo trae quien HOY tiene `user:read` (con él se veía la pestaña de Agencias).
--     · office:write         — crear/mover/desactivar oficinas y asignar personas. Lo trae quien HOY tiene `account:write`.
--     · data:scope:subtree   — ver todo el subárbol de las oficinas asignadas, créditos sin responsable incluidos (gerente regional).
-- 2 · El MANAGER pasa de `data:scope:all` a `data:scope:subtree` y SE ASIGNA A LA RAÍZ de su cuenta. La raíz cubre todo el
--     árbol, así que VE EXACTAMENTE LO MISMO que antes (equivalencia). Un MANAGER nuevo sin asignación ve solo lo suyo (A-4).
--
-- `user_permission_overrides` NO se toca: un permiso concedido a mano a una persona concreta sigue mandando.

INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'office:read',        'office:read',        'office', 'READ',   'ACCOUNT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'office:write',       'office:write',       'office', 'UPDATE', 'ACCOUNT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'data:scope:subtree', 'data:scope:subtree', 'data',   'READ',   'BRANCH',  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- office:read ← los roles que ya leen usuarios.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", po."id"
FROM "role_permissions" rp
JOIN "permissions" pu ON pu."id" = rp."permission_id" AND pu."code" = 'user:read'
JOIN "permissions" po ON po."code" = 'office:read'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- office:write ← los roles que ya escriben la cuenta (hoy: ACCOUNT_ADMIN y SUPER_ADMIN).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT rp."role_id", po."id"
FROM "role_permissions" rp
JOIN "permissions" pa ON pa."id" = rp."permission_id" AND pa."code" = 'account:write'
JOIN "permissions" po ON po."code" = 'office:write'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- data:scope:subtree ← MANAGER (su alcance nuevo) y los que lo traen todo (ROLE_PERMISSIONS = todos los permisos).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'data:scope:subtree'
WHERE r."name" IN ('MANAGER', 'ACCOUNT_ADMIN', 'SUPER_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- Cada MANAGER existente queda asignado a la raíz de su cuenta ANTES de perder `data:scope:all` (misma transacción).
-- Si tenía una oficina suelta en `user_accounts.branch_id` (que con `all` no lo limitaba), la asignación vigente pasa a
-- la raíz: de lo contrario el nuevo alcance lo REDUCIRÍA. El campo legado `user_accounts.branch_id` no se toca.
UPDATE "user_branch_assignments" a
SET "revoked_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
FROM "user_accounts" ua
JOIN "roles" r ON r."id" = ua."role_id" AND r."name" = 'MANAGER'
JOIN "branches" b ON b."account_id" = ua."account_id" AND b."is_root" = true AND b."deleted_at" IS NULL
WHERE a."user_id" = ua."user_id" AND a."account_id" = ua."account_id" AND a."revoked_at" IS NULL AND a."branch_id" <> b."id";

INSERT INTO "user_branch_assignments" ("id", "account_id", "user_id", "branch_id", "is_primary", "updated_at")
SELECT gen_random_uuid()::text, ua."account_id", ua."user_id", b."id", true, CURRENT_TIMESTAMP
FROM "user_accounts" ua
JOIN "roles" r ON r."id" = ua."role_id" AND r."name" = 'MANAGER'
JOIN "branches" b ON b."account_id" = ua."account_id" AND b."is_root" = true AND b."deleted_at" IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "user_branch_assignments" a
  WHERE a."user_id" = ua."user_id" AND a."account_id" = ua."account_id" AND a."branch_id" = b."id" AND a."revoked_at" IS NULL
);

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."name" = 'MANAGER' AND p."code" = 'data:scope:all';
