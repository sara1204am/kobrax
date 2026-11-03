-- F13 · P1 Datos — árbol de oficinas (ADR-0003 APROBADA, ADR-0004 APROBADA).
-- ADITIVA: no borra ni reescribe datos existentes. Lo que cambia de valor es `credits.branch_id` NULL → una oficina
-- (backfill por capas, D-3); los pagos NO se tocan (A-2). El rol y los permisos no cambian en esta migración.
-- Verificación: prisma/verify/oficinas-arbol.sql

-- ── 1 · Catálogo de tipos de oficina (R1: niveles flexibles) ───────────────────────────────────────────────────────
CREATE TABLE "branch_types" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "branch_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branch_types_account_id_code_key" ON "branch_types"("account_id", "code");
ALTER TABLE "branch_types" ADD CONSTRAINT "branch_types_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2 · branches: padre, tipo, ruta materializada ──────────────────────────────────────────────────────────────────
ALTER TABLE "branches"
  ADD COLUMN "parent_id" TEXT,
  ADD COLUMN "type_id" TEXT,
  ADD COLUMN "path" TEXT,
  ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_root" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "external_ref" VARCHAR(80);

ALTER TABLE "branches" ADD CONSTRAINT "branches_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branches" ADD CONSTRAINT "branches_type_id_fkey"
  FOREIGN KEY ("type_id") REFERENCES "branch_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 3 · Relleno estructural (determinista) ─────────────────────────────────────────────────────────────────────────
-- 3a · Tipos por defecto en TODA cuenta. Son editables; solo son el punto de partida.
INSERT INTO "branch_types" ("id", "account_id", "code", "name", "sort_order", "updated_at")
SELECT gen_random_uuid()::text, a."id", t.code, t.name, t.ord, CURRENT_TIMESTAMP
FROM "accounts" a
CROSS JOIN (VALUES ('CENTRAL', 'Central', 0), ('REGIONAL', 'Regional', 1), ('AGENCIA', 'Agencia', 2)) AS t(code, name, ord);

-- 3b · Una oficina raíz por cuenta, con la razón social (ADR-0004). Una sola por cuenta (índice único parcial abajo).
WITH nuevo AS (
  SELECT a."id" AS account_id, a."business_name" AS name, gen_random_uuid()::text AS nid
  FROM "accounts" a
)
INSERT INTO "branches" ("id", "account_id", "name", "type_id", "path", "depth", "is_root", "active", "created_at", "updated_at")
SELECT n.nid, n.account_id, n.name, bt."id", '/' || n.nid || '/', 0, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM nuevo n
JOIN "branch_types" bt ON bt."account_id" = n.account_id AND bt."code" = 'CENTRAL';

-- 3c · Las oficinas que ya existían (planas) pasan a ser agencias hijas de la raíz de su cuenta (incluso las dadas de baja:
--      la ruta es obligatoria para todas).
UPDATE "branches" b
SET "parent_id" = r."id",
    "type_id"   = bt."id",
    "depth"     = 1,
    "path"      = r."path" || b."id" || '/'
FROM "branches" r
JOIN "branch_types" bt ON bt."account_id" = r."account_id" AND bt."code" = 'AGENCIA'
WHERE b."is_root" = false
  AND r."is_root" = true
  AND r."account_id" = b."account_id";

ALTER TABLE "branches" ALTER COLUMN "path" SET NOT NULL;
ALTER TABLE "branches" ALTER COLUMN "type_id" SET NOT NULL;

-- Índices del árbol. `text_pattern_ops`: el subárbol de un nodo es `path LIKE '<path>%'` y usa este índice.
CREATE INDEX "branches_account_id_parent_id_idx" ON "branches"("account_id", "parent_id");
CREATE INDEX "branches_account_id_path_idx" ON "branches"("account_id", "path" text_pattern_ops);
-- Una raíz viva por cuenta; no hay raíz sin cuenta.
CREATE UNIQUE INDEX "branches_one_root_per_account_key" ON "branches"("account_id") WHERE "is_root" = true AND "deleted_at" IS NULL;
-- Referencia al sistema externo del banco (reservado para la ingesta futura; aditivo y sin uso aún).
CREATE UNIQUE INDEX "branches_account_id_external_ref_key" ON "branches"("account_id", "external_ref") WHERE "external_ref" IS NOT NULL AND "deleted_at" IS NULL;

-- ── 4 · Asignaciones usuario ↔ oficina (R3, R8, A-3) ───────────────────────────────────────────────────────────────
CREATE TABLE "user_branch_assignments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    -- ADR-0002: en F13 queda SIEMPRE NULL. El rol efectivo sigue siendo `user_accounts.role_id`; F14 lo consumirá.
    "role_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_branch_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "user_branch_assignments_account_id_user_id_idx" ON "user_branch_assignments"("account_id", "user_id");
CREATE INDEX "user_branch_assignments_account_id_branch_id_idx" ON "user_branch_assignments"("account_id", "branch_id");
-- Una asignación vigente por persona y oficina.
CREATE UNIQUE INDEX "user_branch_assignments_active_key" ON "user_branch_assignments"("user_id", "branch_id") WHERE "revoked_at" IS NULL;
-- TEMPORAL (decisión de la usuaria, 2026-11-02): UNA sola asignación vigente por persona y cuenta hasta que TODOS los
-- consumidores del alcance dejen de usar `LIMIT 1` / `findFirst` (fase P2). Abrir la segunda = `DROP INDEX` de este índice.
CREATE UNIQUE INDEX "user_branch_assignments_one_active_per_account_tmp_key" ON "user_branch_assignments"("account_id", "user_id") WHERE "revoked_at" IS NULL;

ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_branch_assignments" ADD CONSTRAINT "user_branch_assignments_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Espejo de la pertenencia actual: cada persona con `user_accounts.branch_id` queda asignada a esa oficina.
-- (`user_accounts.branch_id` sigue vigente y se escribe en paralelo durante la transición.)
INSERT INTO "user_branch_assignments" ("id", "account_id", "user_id", "branch_id", "is_primary", "updated_at")
SELECT gen_random_uuid()::text, ua."account_id", ua."user_id", ua."branch_id", true, CURRENT_TIMESTAMP
FROM "user_accounts" ua
WHERE ua."branch_id" IS NOT NULL;

-- ── 5 · Créditos: toda oficina válida (A-1, D-3) — backfill por capas, sin inventar datos ──────────────────────────────
-- Capa 1 · la oficina de quien tiene el crédito a su cargo.
-- Sólo cuenta quien sigue activo y una oficina viva (una persona dada de baja o una oficina borrada/apagada no decide).
UPDATE "credits" c
SET "branch_id" = b."id"
FROM "user_accounts" ua
JOIN "branches" b ON b."id" = ua."branch_id" AND b."deleted_at" IS NULL AND b."active" = true
WHERE c."branch_id" IS NULL
  AND c."assigned_manager_id" IS NOT NULL
  AND ua."user_id" = c."assigned_manager_id"
  AND ua."account_id" = c."account_id"
  AND ua."is_active" = true
  AND ua."branch_id" IS NOT NULL;

-- Capa 3 · la única oficina hoja de la cuenta (o su raíz si la cuenta no tiene agencias: tenant individual).
-- Si la cuenta tiene varias agencias, NO se adivina: el crédito queda sin oficina = EXCEPCIÓN que revisa el administrador.
WITH hojas AS (
  SELECT b."account_id",
         count(*) FILTER (WHERE b."is_root" = false AND b."active" = true AND b."deleted_at" IS NULL) AS agencias,
         min(b."id") FILTER (WHERE b."is_root" = false AND b."active" = true AND b."deleted_at" IS NULL) AS unica,
         min(b."id") FILTER (WHERE b."is_root" = true) AS raiz
  FROM "branches" b
  GROUP BY b."account_id"
)
UPDATE "credits" c
SET "branch_id" = CASE WHEN h.agencias = 0 THEN h.raiz WHEN h.agencias = 1 THEN h.unica END
FROM hojas h
WHERE c."branch_id" IS NULL
  AND h."account_id" = c."account_id"
  AND (h.agencias = 0 OR h.agencias = 1);

-- Índices de consulta por oficina (hoy `branch_id` no tiene ninguno).
CREATE INDEX "credits_account_id_branch_id_idx" ON "credits"("account_id", "branch_id");
CREATE INDEX "payments_account_id_branch_id_idx" ON "payments"("account_id", "branch_id");

-- ── 6 · Pagos: oficina HISTÓRICA con FK (A-2, A-7) ─────────────────────────────────────────────────────────────────
-- NOT VALID: se impone a los pagos nuevos sin escanear ni tocar el historial. `verify/oficinas-arbol.sql` informa los
-- huérfanos; la validación completa (`VALIDATE CONSTRAINT`) se hace cuando estén en 0. NINGÚN pago existente se reescribe.
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- ── 7 · RLS por tenant (mismo patrón que `account_requests`; `app_current_account()` ya existe) ────────────────────────
ALTER TABLE "branch_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branch_types" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "branch_types";
CREATE POLICY tenant_isolation ON "branch_types"
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());

ALTER TABLE "user_branch_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_branch_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "user_branch_assignments";
CREATE POLICY tenant_isolation ON "user_branch_assignments"
  USING (account_id = app_current_account())
  WITH CHECK (account_id = app_current_account());
