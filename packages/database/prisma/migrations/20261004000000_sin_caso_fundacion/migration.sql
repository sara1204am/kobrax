-- F4/08 · Fase 1 — «Eliminar el caso»: la base ADITIVA. Plan: docs/epics/F4/08-eliminar-caso.md.
--
-- Nada de lo existente se borra ni se renombra: `collection_cases`, `case_activities`, los `case_id`, los
-- enums del caso y el estado WRITTEN_OFF siguen donde están hasta la fase 6. Esta migración sólo agrega
-- lo que el modelo por crédito necesita y copia a ello lo que ya se sabe. Idempotente (`IF NOT EXISTS`,
-- `duplicate_object`, `ON CONFLICT`, `NOT EXISTS`): correrla dos veces no duplica nada.
--
-- ⚠️ NO escribe las policies de RLS (igual que `credit_notes`): las tablas nuevas se activan con
-- `prisma/rls/001_enable_rls.sql`, que ya las lista (también da el GRANT a `kobrax_app`). Volver a
-- correrla después de aplicar esto.

-- ── 1 · credit_activities: la bitácora del crédito (reemplaza a case_activities) ───────────────────
DO $$ BEGIN
  CREATE TYPE "credit_activity_type" AS ENUM ('NOTE', 'CALL', 'VISIT', 'PAYMENT', 'MESSAGE', 'ASSIGNMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "credit_activities" (
    -- Lo puede traer quien la crea (el móvil, que escribe sin red y reintenta): mismo id = no duplica.
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    -- El episodio de mora vigente al escribirla; NULL = acción preventiva (el crédito estaba al día).
    "episode_id" TEXT,
    "user_id" TEXT,
    "type" "credit_activity_type" NOT NULL,
    "result" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "credit_activities_account_id_credit_id_created_at_idx"
    ON "credit_activities"("account_id", "credit_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "credit_activities_account_id_episode_id_idx"
    ON "credit_activities"("account_id", "episode_id");

DO $$ BEGIN
  ALTER TABLE "credit_activities" ADD CONSTRAINT "credit_activities_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "credit_activities" ADD CONSTRAINT "credit_activities_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "credit_activities" ADD CONSTRAINT "credit_activities_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "credit_activities" ADD CONSTRAINT "credit_activities_episode_id_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "credit_arrear_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2 · credit_arrear_episodes: prioridad (D3) ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "collection_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "credit_arrear_episodes" ADD COLUMN IF NOT EXISTS "priority" "collection_priority";
-- Prioridad fijada a mano: guarda cuándo, no un sí/no (igual que `collection_cases.priority_pinned_at`).
ALTER TABLE "credit_arrear_episodes" ADD COLUMN IF NOT EXISTS "priority_pinned_at" TIMESTAMP(3);

-- ── 3 · credits: última gestión (sólo informativa, D2) y castigo (D1-a) ────────────────────────────
-- Ninguna de las columnas nuevas dispara los triggers de `credits` (escuchan otras columnas).
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "last_action_at" TIMESTAMP(3);
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "written_off_at" TIMESTAMP(3);
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "written_off_by" TEXT;
ALTER TABLE "credits" ADD COLUMN IF NOT EXISTS "written_off_reason" TEXT;

-- ── 4 · arrear_categories: rangos de la categoría de mora, por cuenta (D1-b) ───────────────────────
-- La categoría NO se guarda en el crédito: se calcula con días de mora + estos rangos.
CREATE TABLE IF NOT EXISTS "arrear_categories" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "from_days" INTEGER NOT NULL,
    -- NULL = sin límite (sólo la última).
    "to_days" INTEGER,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arrear_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "arrear_categories_desde_minimo" CHECK ("from_days" >= 1),
    CONSTRAINT "arrear_categories_rango_coherente" CHECK ("to_days" IS NULL OR "to_days" >= "from_days")
);

CREATE UNIQUE INDEX IF NOT EXISTS "arrear_categories_account_id_code_key" ON "arrear_categories"("account_id", "code");
CREATE INDEX IF NOT EXISTS "arrear_categories_account_id_sort_order_idx" ON "arrear_categories"("account_id", "sort_order");

DO $$ BEGIN
  ALTER TABLE "arrear_categories" ADD CONSTRAINT "arrear_categories_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5 · credit_assignments: tipo de asignación (D8-a) ──────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "credit_assignment_kind" AS ENUM ('PRINCIPAL', 'TEMPORAL', 'APOYO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "credit_assignments" ADD COLUMN IF NOT EXISTS "kind" "credit_assignment_kind" NOT NULL DEFAULT 'PRINCIPAL';

-- Para consultar las asignaciones vigentes (TEMPORAL / APOYO) de un crédito.
CREATE INDEX IF NOT EXISTS "credit_assignments_account_id_credit_id_kind_revoked_at_idx"
    ON "credit_assignments"("account_id", "credit_id", "kind", "revoked_at");

-- ── 6 · field_visits y route_stops: credit_id; agenda_items.case_id opcional ───────────────────────
-- `payments`, `agenda_items` y `notifications` ya tienen `credit_id`.
ALTER TABLE "field_visits" ADD COLUMN IF NOT EXISTS "credit_id" TEXT;
ALTER TABLE "route_stops" ADD COLUMN IF NOT EXISTS "credit_id" TEXT;

CREATE INDEX IF NOT EXISTS "field_visits_account_id_credit_id_idx" ON "field_visits"("account_id", "credit_id");
CREATE INDEX IF NOT EXISTS "route_stops_account_id_credit_id_idx" ON "route_stops"("account_id", "credit_id");
CREATE INDEX IF NOT EXISTS "notifications_account_id_credit_id_idx" ON "notifications"("account_id", "credit_id");
CREATE INDEX IF NOT EXISTS "agenda_items_account_id_credit_id_idx" ON "agenda_items"("account_id", "credit_id");

-- Sin FOREIGN KEY a propósito: es referencia suave como `notifications.credit_id` y `agenda_items.credit_id`.

-- Una acción agendada ya no exige un caso abierto (acciones preventivas sobre un crédito al día).
ALTER TABLE "agenda_items" ALTER COLUMN "case_id" DROP NOT NULL;

-- ── 7 · Permisos `collection:*` (D5), en coexistencia con `case:*` ─────────────────────────────────
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "created_at", "updated_at")
SELECT gen_random_uuid()::text, replace(p."code", 'case:', 'collection:'), replace(p."code", 'case:', 'collection:'),
       'collection', p."action", p."scope", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "permissions" p
WHERE p."code" IN ('case:read', 'case:write', 'case:export')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id", "granted_by", "granted_at")
SELECT rp."role_id", n."id", rp."granted_by", rp."granted_at"
FROM "role_permissions" rp
JOIN "permissions" o ON o."id" = rp."permission_id" AND o."code" IN ('case:read', 'case:write', 'case:export')
JOIN "permissions" n ON n."code" = replace(o."code", 'case:', 'collection:')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "user_permission_overrides" ("id", "user_id", "account_id", "permission_id", "granted", "reason", "expires_at", "granted_by", "created_at")
SELECT gen_random_uuid()::text, upo."user_id", upo."account_id", n."id", upo."granted", upo."reason", upo."expires_at", upo."granted_by", upo."created_at"
FROM "user_permission_overrides" upo
JOIN "permissions" o ON o."id" = upo."permission_id" AND o."code" IN ('case:read', 'case:write', 'case:export')
JOIN "permissions" n ON n."code" = replace(o."code", 'case:', 'collection:')
WHERE NOT EXISTS (
  SELECT 1 FROM "user_permission_overrides" x
  WHERE x."user_id" = upo."user_id" AND x."account_id" IS NOT DISTINCT FROM upo."account_id"
    AND x."permission_id" = n."id" AND x."granted" = upo."granted"
);

-- ═══════════════════════════ BACKFILLS ═══════════════════════════

-- ── B1 · case_activities → credit_activities, CONSERVANDO el id ────────────────────────────────────
-- `agenda_items.result_activity_id` apunta a estos ids. El crédito y el cliente salen del caso; el
-- episodio es el del crédito cuyo periodo [started_at, ended_at o abierto] contiene el día de la gestión.
-- STATUS_CHANGE deja de existir como tipo: pasa a NOTE y conserva su texto.
INSERT INTO "credit_activities" ("id", "account_id", "credit_id", "client_id", "episode_id", "user_id", "type", "result", "notes", "created_at")
SELECT ca."id", ca."account_id", cc."credit_id", cc."client_id", ep."id", ca."user_id",
       (CASE ca."type"::text WHEN 'STATUS_CHANGE' THEN 'NOTE' ELSE ca."type"::text END)::"credit_activity_type",
       ca."result",
       CASE WHEN ca."type"::text = 'STATUS_CHANGE'
            THEN CASE WHEN ca."notes" IS NULL OR btrim(ca."notes") = '' THEN 'Cambio de estado'
                      ELSE 'Cambio de estado: ' || ca."notes" END
            ELSE ca."notes" END,
       ca."created_at"
FROM "case_activities" ca
JOIN "collection_cases" cc ON cc."id" = ca."case_id"
LEFT JOIN LATERAL (
  SELECT e."id"
  FROM "credit_arrear_episodes" e
  WHERE e."credit_id" = cc."credit_id"
    AND e."started_at" <= ca."created_at"::date
    AND (e."ended_at" IS NULL OR e."ended_at" >= ca."created_at"::date)
  ORDER BY e."started_at" DESC
  LIMIT 1
) ep ON true
ON CONFLICT ("id") DO NOTHING;

-- ── B2 · prioridad del episodio ABIERTO, desde el caso abierto del crédito ─────────────────────────
UPDATE "credit_arrear_episodes" e
SET "priority" = oc."priority"::text::"collection_priority", "priority_pinned_at" = oc."priority_pinned_at"
FROM (
  SELECT DISTINCT ON (c."credit_id") c."credit_id", c."priority", c."priority_pinned_at"
  FROM "collection_cases" c
  WHERE c."deleted_at" IS NULL AND c."status"::text NOT IN ('PAID', 'CLOSED', 'WRITTEN_OFF')
  ORDER BY c."credit_id", c."created_at" DESC
) oc
WHERE e."credit_id" = oc."credit_id" AND e."ended_at" IS NULL AND e."priority" IS NULL;

-- ── B3 · credits: última gestión y castigo ─────────────────────────────────────────────────────────
UPDATE "credits" c
SET "last_action_at" = a."last"
FROM (SELECT "credit_id", max("created_at") AS "last" FROM "credit_activities" GROUP BY "credit_id") a
WHERE a."credit_id" = c."id" AND c."last_action_at" IS NULL;

-- El estado WRITTEN_OFF sigue existiendo hasta la fase 6; `written_off_at` ya es la fuente de verdad.
UPDATE "credits"
SET "written_off_at" = "updated_at"
WHERE "status"::text = 'WRITTEN_OFF' AND "written_off_at" IS NULL;

-- ── B4 · categorías iniciales A 1–30, B 31–60, C 61+ para CADA cuenta existente ────────────────────
-- Espejo de `DEFAULT_ARREAR_CATEGORIES` (shared). Editables después desde Administración.
INSERT INTO "arrear_categories" ("id", "account_id", "code", "name", "from_days", "to_days", "color", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid()::text, a."id", d."code", d."name", d."from_days", d."to_days", d."color", d."sort_order", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "accounts" a
CROSS JOIN (VALUES
  ('A', 'Categoría A', 1, 30, NULL::text, 1),
  ('B', 'Categoría B', 31, 60, NULL::text, 2),
  ('C', 'Categoría C', 61, NULL::int, NULL::text, 3)
) AS d("code", "name", "from_days", "to_days", "color", "sort_order")
ON CONFLICT ("account_id", "code") DO NOTHING;

-- ── B5 · credit_assignments: el tipo de lo que ya existía ──────────────────────────────────────────
-- La permanente (sin vencimiento ni caso) es PRINCIPAL, que es el default. Lo que vence por fecha o
-- nació de reasignar un caso es una cobertura: TEMPORAL.
UPDATE "credit_assignments"
SET "kind" = 'TEMPORAL'
WHERE "kind" = 'PRINCIPAL' AND ("expires_at" IS NOT NULL OR "case_id" IS NOT NULL);

-- Una sola PRINCIPAL vigente por crédito. El predicado gana `kind = 'PRINCIPAL'`: sin él, una ayuda
-- (APOYO, sin vencimiento) chocaría con el responsable. Mismo nombre que antes.
DROP INDEX IF EXISTS "credit_assignments_one_permanent_per_credit";
CREATE UNIQUE INDEX "credit_assignments_one_permanent_per_credit"
    ON "credit_assignments"("account_id", "credit_id")
    WHERE "expires_at" IS NULL AND "case_id" IS NULL AND "revoked_at" IS NULL AND "kind" = 'PRINCIPAL';

-- ── B6 · credit_id de visitas, paradas y notificaciones, por su caso ───────────────────────────────
UPDATE "field_visits" v SET "credit_id" = cc."credit_id"
FROM "collection_cases" cc WHERE cc."id" = v."case_id" AND v."credit_id" IS NULL;

UPDATE "route_stops" s SET "credit_id" = cc."credit_id"
FROM "collection_cases" cc WHERE cc."id" = s."case_id" AND s."credit_id" IS NULL;

UPDATE "notifications" n SET "credit_id" = cc."credit_id"
FROM "collection_cases" cc WHERE cc."id" = n."case_id" AND n."credit_id" IS NULL;
