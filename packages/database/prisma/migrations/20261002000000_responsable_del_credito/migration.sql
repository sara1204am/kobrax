-- Responsable del crédito: permisos que faltaban + `credit_assignments` sincronizada.
-- Sólo datos: no cambia el schema. Idempotente — correrla dos veces no duplica nada.
-- Plan: memoria «asignacion-importacion» / decisiones P1–P11 (2026-09-30).

/*
 * 1 · Dos permisos que el código reparte y la base no tenía.
 *
 * `ROLE_PERMISSIONS` (shared) se los da a los roles, pero el catálogo del seed no los listaba y el
 * seed se saltea en silencio lo que no está en el catálogo: nadie los recibía en el JWT. Con
 * `assignment:write` ausente, exigirlo habría dejado a gerentes y administradores sin poder asignar.
 * `data:scope:all` no cambia nada visible todavía: ninguna policy de RLS lee el alcance (F2).
 */
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "created_at", "updated_at")
VALUES
  (gen_random_uuid()::text, 'assignment:write', 'assignment:write', 'assignments', 'UPDATE', 'ACCOUNT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'data:scope:all', 'data:scope:all', 'data', 'READ', 'ACCOUNT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

/*
 * 2 · A cada rol lo suyo, espejo de `ROLE_PERMISSIONS`:
 *   - assignment:write → SUPER_ADMIN, ACCOUNT_ADMIN, MANAGER, SUPERVISOR
 *   - data:scope:all   → todos menos COLLECTOR
 *   - client:import    → SUPERVISOR (nuevo: importa y reparte en el mismo paso)
 * Una base sin roles (antes del seed) no recibe nada, y el seed los pone después.
 */
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON
     (p."code" = 'assignment:write' AND r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'MANAGER', 'SUPERVISOR'))
  OR (p."code" = 'data:scope:all'   AND r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'MANAGER', 'SUPERVISOR', 'AUDITOR', 'VIEWER'))
  OR (p."code" = 'client:import'    AND r."name" = 'SUPERVISOR')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

/*
 * 3 · `credit_assignments` vuelve a decir lo mismo que `credits.assigned_manager_id`.
 *
 * La tabla se llenó una sola vez (20260826000000) y desde entonces nadie la escribió: el import, el
 * alta y el PATCH sólo tocaban la columna. La columna es la que se mantuvo al día, así que manda.
 * Desde acá en adelante las dos las escribe `AssignmentService`, y `db:audit:assignments` verifica.
 */

-- 3a · Se revoca la permanente vigente que ya no corresponde (otro responsable, sin responsable,
-- o crédito borrado). No se borra: la tabla es el historial.
UPDATE "credit_assignments" ca
SET "revoked_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
FROM "credits" c
WHERE ca."credit_id" = c."id"
  AND ca."revoked_at" IS NULL AND ca."expires_at" IS NULL AND ca."case_id" IS NULL
  AND (c."deleted_at" IS NOT NULL OR c."assigned_manager_id" IS NULL OR c."assigned_manager_id" <> ca."user_id");

-- 3b · Y se crea la que falta. `starts_at` = la última modificación del crédito: es lo más cerca
-- que se puede saber de cuándo empezó este responsable (la fecha exacta no quedó en ningún lado).
INSERT INTO "credit_assignments" ("id", "account_id", "credit_id", "user_id", "starts_at", "created_at", "updated_at")
SELECT gen_random_uuid()::text, c."account_id", c."id", c."assigned_manager_id", c."updated_at", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "credits" c
WHERE c."assigned_manager_id" IS NOT NULL AND c."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "credit_assignments" ca
    WHERE ca."credit_id" = c."id" AND ca."revoked_at" IS NULL AND ca."expires_at" IS NULL AND ca."case_id" IS NULL
  );
