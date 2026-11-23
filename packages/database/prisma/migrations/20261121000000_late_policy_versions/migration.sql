-- Política de mora versionada y SELLADA por crédito (evaluación «gestión de mora del MVP»).
--
-- POR QUÉ
-- La mora hoy sólo mide el atraso. Cuando una cuenta defina cargos por mora (interés moratorio anual, más adelante), esos cargos no pueden
-- cambiar retroactivamente los créditos que ya existen: cada crédito tiene que conservar, inmutable, la política con la que nació. Esta
-- migración crea las versiones de política (append-only) y sella TODOS los créditos —los que existen y los que se creen por cualquier
-- camino— con la política vigente de su cuenta. Hoy esa política es `NONE` (sin cargos adicionales) para todas las cuentas: no se asigna ninguna
-- tasa no documentada ni se genera ningún cargo retroactivo.
--
-- DISEÑO
--  · `late_policy_versions`: una fila por versión; la cuenta (`scope = ACCOUNT`) o un producto (`scope = PRODUCT` + `type_code`). Append-only.
--  · `credits.late_policy_version_id`: la referencia. Un trigger BEFORE INSERT la sella si falta (producto primero, si no la de la cuenta; si la
--    cuenta no tiene ninguna, crea la v1 `NONE`): así el API, el importador, el seed y el móvil quedan cubiertos sin tocar código.
--  · Otro trigger impide cambiar la referencia una vez puesta (para los roles de la aplicación; el mantenimiento como propietario queda fuera).
--  · RLS por tenant y permisos (sin UPDATE/DELETE) viven en `rls/` (correr `db:rls`).
--
-- ROLLBACK: aditivo. DROP TRIGGER credits_seal_late_policy / credits_late_policy_immutable ON credits; ALTER TABLE credits DROP COLUMN
-- late_policy_version_id; DROP TABLE late_policy_versions; DROP TYPE late_policy_kind, late_policy_scope.

CREATE TYPE "late_policy_scope" AS ENUM ('ACCOUNT', 'PRODUCT');
CREATE TYPE "late_policy_kind" AS ENUM ('NONE', 'ANNUAL_RATE');

CREATE TABLE "late_policy_versions" (
    "id"             TEXT NOT NULL,
    "account_id"     TEXT NOT NULL,
    "scope"          "late_policy_scope" NOT NULL DEFAULT 'ACCOUNT',
    "type_code"      TEXT,
    "version"        INTEGER NOT NULL,
    "kind"           "late_policy_kind" NOT NULL DEFAULT 'NONE',
    "annual_rate"    DECIMAL(7,4),
    "day_count"      SMALLINT,
    "grace_days"     SMALLINT NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"     TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "late_policy_versions_pkey" PRIMARY KEY ("id"),
    -- El producto lleva su tipo; la cuenta, no.
    CONSTRAINT "late_policy_versions_scope_type" CHECK (("scope" = 'PRODUCT') = ("type_code" IS NOT NULL)),
    -- Sin cargos = sin parámetros de cargo; con interés anual, tasa positiva y convención de 360 ó 365 días.
    CONSTRAINT "late_policy_versions_kind_params" CHECK (
        ("kind" = 'NONE' AND "annual_rate" IS NULL AND "day_count" IS NULL)
        OR ("kind" = 'ANNUAL_RATE' AND "annual_rate" > 0 AND "day_count" IN (360, 365))
    ),
    CONSTRAINT "late_policy_versions_grace_nonneg" CHECK ("grace_days" >= 0),
    CONSTRAINT "late_policy_versions_version_pos" CHECK ("version" > 0)
);

-- Una versión por (cuenta, alcance, producto): el número sube de a uno. Índice con expresión: Prisma no lo expresa (igual que otros únicos parciales).
CREATE UNIQUE INDEX "late_policy_versions_unique_version"
    ON "late_policy_versions"("account_id", "scope", (COALESCE("type_code", '')), "version");
CREATE INDEX "late_policy_versions_account_id_scope_type_code_idx" ON "late_policy_versions"("account_id", "scope", "type_code");

ALTER TABLE "late_policy_versions"
    ADD CONSTRAINT "late_policy_versions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credits" ADD COLUMN "late_policy_version_id" TEXT;
ALTER TABLE "credits"
    ADD CONSTRAINT "credits_late_policy_version_id_fkey" FOREIGN KEY ("late_policy_version_id") REFERENCES "late_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "credits_late_policy_version_id_idx" ON "credits"("late_policy_version_id");

-- ── Backfill: todas las cuentas con la política v1 «sin cargos adicionales», y sus créditos sellados con ella ──────────────────
INSERT INTO "late_policy_versions" ("id", "account_id", "scope", "type_code", "version", "kind")
SELECT gen_random_uuid()::text, a."id", 'ACCOUNT', NULL, 1, 'NONE' FROM "accounts" a
ON CONFLICT DO NOTHING;

UPDATE "credits" c SET "late_policy_version_id" = v."id"
FROM "late_policy_versions" v
WHERE v."account_id" = c."account_id" AND v."scope" = 'ACCOUNT' AND v."version" = 1 AND c."late_policy_version_id" IS NULL;

-- ── Sellado al crear un crédito (todos los caminos) ──────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: lee y, si hace falta, crea la v1 de la cuenta sin que el alcance de quien inserta se lo impida.
CREATE OR REPLACE FUNCTION credits_seal_late_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v text;
BEGIN
  IF NEW.late_policy_version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- La política del producto (la última versión de su tipo de crédito), si la hay…
  IF NEW.type_code IS NOT NULL THEN
    SELECT id INTO v FROM late_policy_versions
     WHERE account_id = NEW.account_id AND scope = 'PRODUCT' AND type_code = NEW.type_code
     ORDER BY version DESC LIMIT 1;
  END IF;
  -- …si no, la de la cuenta…
  IF v IS NULL THEN
    SELECT id INTO v FROM late_policy_versions
     WHERE account_id = NEW.account_id AND scope = 'ACCOUNT'
     ORDER BY version DESC LIMIT 1;
  END IF;
  -- …y si la cuenta todavía no tiene ninguna (cuenta nueva), nace la v1 sin cargos.
  IF v IS NULL THEN
    INSERT INTO late_policy_versions (id, account_id, scope, type_code, version, kind)
    VALUES (gen_random_uuid()::text, NEW.account_id, 'ACCOUNT', NULL, 1, 'NONE')
    ON CONFLICT DO NOTHING;
    SELECT id INTO v FROM late_policy_versions WHERE account_id = NEW.account_id AND scope = 'ACCOUNT' ORDER BY version DESC LIMIT 1;
  END IF;
  NEW.late_policy_version_id := v;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credits_seal_late_policy BEFORE INSERT ON credits
  FOR EACH ROW EXECUTE FUNCTION credits_seal_late_policy();

-- ── La referencia no se cambia una vez puesta (los roles de la aplicación; el mantenimiento queda fuera, como en `payments`) ────────
CREATE OR REPLACE FUNCTION credits_guard_late_policy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('kobrax_app', 'kobrax_scoped')
     AND OLD.late_policy_version_id IS NOT NULL
     AND NEW.late_policy_version_id IS DISTINCT FROM OLD.late_policy_version_id THEN
    RAISE EXCEPTION 'credits.late_policy_version_id es inmutable: la política con que nació el crédito no se cambia' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credits_late_policy_immutable BEFORE UPDATE OF late_policy_version_id ON credits
  FOR EACH ROW EXECUTE FUNCTION credits_guard_late_policy();

-- ── Las versiones de política son append-only para la aplicación ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION late_policy_versions_guard_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('kobrax_app', 'kobrax_scoped') THEN
    RAISE EXCEPTION 'late_policy_versions es inmutable: % no permitido (una política nueva es una versión nueva)', TG_OP USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER late_policy_versions_immutable BEFORE UPDATE OR DELETE ON late_policy_versions
  FOR EACH ROW EXECUTE FUNCTION late_policy_versions_guard_mutation();
