-- F14 · F1 — el MANAGER (gerente regional) también cierra sesiones de las personas de su oficina.
-- Aditiva: sólo agrega una fila a role_permissions. El servidor acota por alcance (otra regional → 404).
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'user:sessions:revoke'
WHERE r."name" = 'MANAGER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
