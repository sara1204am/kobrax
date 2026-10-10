-- F4/12 · Rutas — quien administra rutas (gerente y supervisor) también registra el cobro de una visita que carga desde el panel.
--
-- Decisión 2026-10-08: hasta hoy `payment:write` era del cobrador y del administrador, así que un gerente podía cargar la
-- visita de un cobrador que se olvidó o se quedó sin batería, pero no el cobro que hizo. Sólo datos: no cambia el schema.
-- Idempotente. Espejo de `ROLE_PERMISSIONS` (shared).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payment:write'
WHERE r."name" IN ('MANAGER', 'SUPERVISOR')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
