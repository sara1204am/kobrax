-- F13 · D-7 — el SUPERVISOR lee el árbol de oficinas (`office:read`), acotado por el servidor a sus oficinas y su subárbol.
-- Sólo datos. Idempotente. Espejo de `ROLE_PERMISSIONS` (shared) y de `seed.ts`.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'office:read'
WHERE r."name" = 'SUPERVISOR'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
