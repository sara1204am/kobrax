-- Central de Mora (F4/07 · T5): permiso `case:export` para descargar la lista de Mora (CSV/PDF).
-- Sólo datos: no cambia el schema. Idempotente — correrla dos veces no duplica nada.
--
-- 🔴 Es un permiso NUEVO y no `report:export`. Ese otro habilita `GET /exports/cases|clients|locations|
-- backup`, que no filtran por alcance y entregan datos personales en claro: dárselo a un cobrador le
-- permitiría bajar toda la cartera. `case:export` sólo abre `/mora/export.*`, que respeta el filtro, el
-- orden y el alcance de quien lo baja (el cobrador descarga únicamente sus casos) y no lleva teléfonos
-- ni direcciones.
--
-- Decisión 2026-10-01: pueden exportar todos los roles que ya ven Mora (`case:read`).
-- Espejo de `ROLE_PERMISSIONS` (shared).
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "created_at", "updated_at")
VALUES (gen_random_uuid()::text, 'case:export', 'case:export', 'cases', 'EXECUTE', 'ACCOUNT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'case:export'
WHERE r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'MANAGER', 'SUPERVISOR', 'COLLECTOR', 'AUDITOR', 'VIEWER')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
