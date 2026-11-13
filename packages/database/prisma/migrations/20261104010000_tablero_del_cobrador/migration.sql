-- F13 · el COBRADOR tiene tablero de Inicio (`report:read`). La API acota la analítica a lo suyo (alcance propio), así que no ve más
-- que sus créditos. Sólo datos. Idempotente. Espejo de `ROLE_PERMISSIONS` (shared).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'report:read'
WHERE r."name" = 'COLLECTOR'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
