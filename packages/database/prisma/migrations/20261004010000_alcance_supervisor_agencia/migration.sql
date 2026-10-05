-- F4/08 · D8 (fase 2B): el supervisor ve SU AGENCIA, no toda la empresa.
-- Sólo datos: no cambia el schema. Idempotente — correrla dos veces no duplica ni borra de más.
--
-- Hasta ahora el SUPERVISOR tenía `data:scope:all`. Pasa a `data:scope:branch`: créditos cuya sucursal es la
-- suya (`user_accounts.branch_id`) más los que tiene a su cargo (responsable, temporal o apoyo).
-- Gerente y administrador siguen con `data:scope:all`; el cobrador no tiene ninguno (sólo lo suyo).
-- Espejo de `ROLE_PERMISSIONS` (shared) y de `seed.ts`.
--
-- `user_permission_overrides` NO se toca a propósito: un `data:scope:all` concedido a mano a un supervisor
-- concreto es una decisión explícita de un administrador y sigue mandando.

INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'data:scope:branch', 'data:scope:branch', 'data', 'READ', 'BRANCH', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'data:scope:branch'
WHERE r."name" = 'SUPERVISOR'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
  AND r."name" = 'SUPERVISOR' AND p."code" = 'data:scope:all';
