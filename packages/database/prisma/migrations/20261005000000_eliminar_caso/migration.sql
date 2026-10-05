-- F4/08 · FASE 6 — contracción: el «caso» de cobranza deja de existir. IRREVERSIBLE.
--
-- Todo lo que hacía el caso vive ya en el crédito (`credit_activities`, `credit_arrear_episodes`,
-- `credit_assignments`, `credits.written_off_*`). Esta migración borra lo que quedó atrás, en este orden:
--   1 · `case_id` (FK, índices y columna) de las tablas que lo tenían
--   2 · tablas `case_activities` y `collection_cases`
--   3 · enums del caso
--   4 · valores CASE_* de `NotificationType` y WRITTEN_OFF de `CreditStatus`
--   5 · permisos `case:*`
-- `route_plans.total_cases` se queda: es un contador de paradas, no una referencia al caso.

-- ── 1 · case_id fuera ────────────────────────────────────────────────────────────────────────────
ALTER TABLE "payments"      DROP CONSTRAINT IF EXISTS "payments_case_id_fkey";
ALTER TABLE "field_visits"  DROP CONSTRAINT IF EXISTS "field_visits_case_id_fkey";
ALTER TABLE "route_stops"   DROP CONSTRAINT IF EXISTS "route_stops_case_id_fkey";

-- El único parcial del responsable decía «sin caso». Sin la columna ya no hay caso que excluir: se
-- recrea con el mismo sentido (una PRINCIPAL vigente, sin vencimiento, por crédito). Una PRINCIPAL que
-- aún conservara `case_id` era una cobertura atada a un caso: pasa a TEMPORAL para no chocar con la
-- responsable al crear el índice.
UPDATE "credit_assignments" SET "kind" = 'TEMPORAL'
WHERE "kind" = 'PRINCIPAL' AND "case_id" IS NOT NULL AND "revoked_at" IS NULL AND "expires_at" IS NULL;

DROP INDEX IF EXISTS "credit_assignments_one_permanent_per_credit";
DROP INDEX IF EXISTS "credit_assignments_account_id_case_id_idx";
ALTER TABLE "credit_assignments" DROP COLUMN IF EXISTS "case_id";
CREATE UNIQUE INDEX "credit_assignments_one_permanent_per_credit"
    ON "credit_assignments"("account_id", "credit_id")
    WHERE "expires_at" IS NULL AND "revoked_at" IS NULL AND "kind" = 'PRINCIPAL';

-- (el DROP COLUMN también se llevaría los índices; se nombran para que quede escrito)
DROP INDEX IF EXISTS "agenda_items_account_id_case_id_idx";
DROP INDEX IF EXISTS "field_visits_account_id_case_id_idx";
ALTER TABLE "agenda_items"     DROP COLUMN IF EXISTS "case_id";
ALTER TABLE "payments"         DROP COLUMN IF EXISTS "case_id";
ALTER TABLE "payment_requests" DROP COLUMN IF EXISTS "case_id";
ALTER TABLE "field_visits"     DROP COLUMN IF EXISTS "case_id";
ALTER TABLE "route_stops"      DROP COLUMN IF EXISTS "case_id";
ALTER TABLE "notifications"    DROP COLUMN IF EXISTS "case_id";

-- ── 2 · las tablas del caso (sus policies e índices parciales caen con ellas) ─────────────────────
DROP TABLE IF EXISTS "case_activities";
DROP TABLE IF EXISTS "collection_cases";

-- ── 3 · enums del caso (ya nada los usa) ──────────────────────────────────────────────────────────
DROP TYPE IF EXISTS "CaseStatus";
DROP TYPE IF EXISTS "CasePriority";
DROP TYPE IF EXISTS "CaseActivityType";

-- ── 4a · NotificationType sin CASE_ASSIGNED / CASE_UPDATED ────────────────────────────────────────
-- PG no quita valores de un enum: se crea el tipo nuevo, se convierte la columna y se renombra.
DELETE FROM "notifications" WHERE "type"::text IN ('CASE_ASSIGNED', 'CASE_UPDATED');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'NotificationType' AND e.enumlabel IN ('CASE_ASSIGNED', 'CASE_UPDATED')) THEN
    CREATE TYPE "NotificationType_new" AS ENUM ('PAYMENT_REGISTERED', 'ROUTE_ASSIGNED', 'PROMISE_DUE', 'SYSTEM');
    ALTER TABLE "notifications" ALTER COLUMN "type" DROP DEFAULT;
    ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
    ALTER TABLE "notifications" ALTER COLUMN "type" SET DEFAULT 'SYSTEM';
    DROP TYPE "NotificationType";
    ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
  END IF;
END $$;

-- ── 4b · CreditStatus sin WRITTEN_OFF (el castigo vive en `credits.written_off_at`) ───────────────
-- Los triggers de episodios dependen de `credits.status` (UPDATE OF status + WHEN OLD.status…): PG no
-- deja cambiarle el tipo a la columna mientras existan, y además migrar la fila castigada no debe tocar
-- los episodios. Se sueltan, se migra, y se recrean más abajo.
DROP TRIGGER IF EXISTS credits_arrear_episode_ins ON "credits";
DROP TRIGGER IF EXISTS credits_arrear_episode_upd ON "credits";

UPDATE "credits"
SET "written_off_at" = COALESCE("written_off_at", "updated_at"), "status" = 'ACTIVE'
WHERE "status"::text = 'WRITTEN_OFF';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
             WHERE t.typname = 'CreditStatus' AND e.enumlabel = 'WRITTEN_OFF') THEN
    CREATE TYPE "CreditStatus_new" AS ENUM ('ACTIVE', 'PAID', 'DEFAULTED', 'RESTRUCTURED', 'CANCELLED');
    ALTER TABLE "credits" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "credits" ALTER COLUMN "status" TYPE "CreditStatus_new" USING ("status"::text::"CreditStatus_new");
    ALTER TABLE "credits" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
    DROP TYPE "CreditStatus";
    ALTER TYPE "CreditStatus_new" RENAME TO "CreditStatus";
  END IF;
END $$;

-- El trigger de episodios sin WRITTEN_OFF. El castigo es una condición independiente de la mora (D1): un
-- crédito castigado con días de mora SIGUE en mora y conserva su episodio abierto; castigar ya no cierra
-- episodios (el valor `WRITTEN_OFF` de `arrear_episode_end` queda sólo para los episodios históricos).
CREATE OR REPLACE FUNCTION credits_track_arrear_episode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  in_mora   boolean;
  open_id   text;
  reopen_id text;
  declared  date;
  reason    "arrear_episode_end";
BEGIN
  in_mora := NEW.deleted_at IS NULL
         AND NEW.days_past_due > 0
         AND NEW.status::text NOT IN ('PAID', 'CANCELLED');

  SELECT id INTO open_id FROM credit_arrear_episodes WHERE credit_id = NEW.id AND ended_at IS NULL;

  IF in_mora THEN
    IF open_id IS NOT NULL THEN
      UPDATE credit_arrear_episodes
         SET max_days_past_due = NEW.days_past_due, updated_at = CURRENT_TIMESTAMP
       WHERE id = open_id AND COALESCE(max_days_past_due, 0) < NEW.days_past_due;
      RETURN NULL;
    END IF;

    SELECT id INTO reopen_id
      FROM credit_arrear_episodes
     WHERE credit_id = NEW.id AND end_reason = 'SOURCE_ABSENT'
     ORDER BY started_at DESC, created_at DESC
     LIMIT 1;
    IF reopen_id IS NOT NULL AND NEW.sync_status::text = 'PRESENT' THEN
      UPDATE credit_arrear_episodes
         SET ended_at = NULL, end_reason = NULL, balance_at_end = NULL,
             max_days_past_due = GREATEST(COALESCE(max_days_past_due, 0), NEW.days_past_due),
             updated_at = CURRENT_TIMESTAMP
       WHERE id = reopen_id;
      RETURN NULL;
    END IF;

    declared := arrear_episode_declared_start(NEW.metadata);
    INSERT INTO credit_arrear_episodes (
      id, account_id, credit_id, started_at, started_at_estimated, start_days_past_due,
      max_days_past_due, balance_at_start, source
    ) VALUES (
      gen_random_uuid()::text, NEW.account_id, NEW.id,
      COALESCE(declared, COALESCE(NEW.reported_as_of, CURRENT_DATE) - NEW.days_past_due),
      declared IS NULL,
      NEW.days_past_due, NEW.days_past_due, NEW.outstanding_balance,
      arrear_episode_source_of(NEW.origin::text, NEW.metadata)
    );
    RETURN NULL;
  END IF;

  reason := CASE
    WHEN NEW.deleted_at IS NOT NULL THEN 'DELETED'
    WHEN NEW.status::text = 'CANCELLED' THEN 'CANCELLED'
    WHEN NEW.sync_status::text = 'ABSENT' THEN 'SOURCE_ABSENT'
    WHEN NEW.status::text = 'PAID' OR NEW.outstanding_balance <= 0.005 THEN 'PAID'
    ELSE 'CURRENT'
  END;

  IF open_id IS NOT NULL THEN
    UPDATE credit_arrear_episodes
       SET ended_at = GREATEST(CURRENT_DATE, started_at), end_reason = reason,
           balance_at_end = NEW.outstanding_balance, updated_at = CURRENT_TIMESTAMP
     WHERE id = open_id;
  ELSIF NEW.sync_status::text = 'PRESENT' THEN
    UPDATE credit_arrear_episodes
       SET end_reason = reason, balance_at_end = NEW.outstanding_balance, updated_at = CURRENT_TIMESTAMP
     WHERE credit_id = NEW.id AND end_reason = 'SOURCE_ABSENT';
  ELSIF TG_OP = 'UPDATE' AND NEW.sync_status::text = 'ABSENT' AND OLD.sync_status::text IS DISTINCT FROM 'ABSENT' THEN
    UPDATE credit_arrear_episodes
       SET end_reason = 'SOURCE_ABSENT', updated_at = CURRENT_TIMESTAMP
     WHERE credit_id = NEW.id AND end_reason = 'CURRENT' AND updated_at = CURRENT_TIMESTAMP::timestamp(3);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER credits_arrear_episode_ins
  AFTER INSERT ON "credits"
  FOR EACH ROW
  WHEN (NEW.days_past_due > 0)
  EXECUTE FUNCTION credits_track_arrear_episode();

CREATE TRIGGER credits_arrear_episode_upd
  AFTER UPDATE OF days_past_due, status, deleted_at, sync_status ON "credits"
  FOR EACH ROW
  WHEN (
    OLD.days_past_due IS DISTINCT FROM NEW.days_past_due
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
    OR OLD.sync_status IS DISTINCT FROM NEW.sync_status
  )
  EXECUTE FUNCTION credits_track_arrear_episode();

-- Los castigados que siguen en mora: antes el estado WRITTEN_OFF les había cerrado el episodio. Ahora el
-- castigo no cierra nada, así que se reabre ese episodio (o se abre uno, si nunca lo tuvieron) para que
-- cumplan la misma invariante que el resto: en mora ⇒ episodio abierto.
UPDATE "credit_arrear_episodes" e
SET "ended_at" = NULL, "end_reason" = NULL, "balance_at_end" = NULL, "updated_at" = CURRENT_TIMESTAMP
FROM "credits" c
WHERE c."id" = e."credit_id" AND e."end_reason"::text = 'WRITTEN_OFF'
  AND c."written_off_at" IS NOT NULL AND c."deleted_at" IS NULL AND c."days_past_due" > 0
  AND c."status"::text NOT IN ('PAID', 'CANCELLED')
  AND NOT EXISTS (SELECT 1 FROM "credit_arrear_episodes" o WHERE o."credit_id" = c."id" AND o."ended_at" IS NULL)
  AND e."started_at" = (SELECT max(x."started_at") FROM "credit_arrear_episodes" x WHERE x."credit_id" = c."id")
  AND e."id" = (SELECT x."id" FROM "credit_arrear_episodes" x WHERE x."credit_id" = c."id" ORDER BY x."started_at" DESC, x."created_at" DESC LIMIT 1);

INSERT INTO "credit_arrear_episodes" (
  "id", "account_id", "credit_id", "started_at", "started_at_estimated", "start_days_past_due",
  "max_days_past_due", "balance_at_start", "source"
)
SELECT gen_random_uuid()::text, c."account_id", c."id",
       COALESCE(arrear_episode_declared_start(c."metadata"), COALESCE(c."reported_as_of", CURRENT_DATE) - c."days_past_due"),
       arrear_episode_declared_start(c."metadata") IS NULL,
       c."days_past_due", c."days_past_due", c."outstanding_balance",
       arrear_episode_source_of(c."origin"::text, c."metadata")
FROM "credits" c
WHERE c."written_off_at" IS NOT NULL AND c."deleted_at" IS NULL AND c."days_past_due" > 0
  AND c."status"::text NOT IN ('PAID', 'CANCELLED')
  AND NOT EXISTS (SELECT 1 FROM "credit_arrear_episodes" e WHERE e."credit_id" = c."id" AND e."ended_at" IS NULL);

-- ── 5 · permisos `case:*` (los reemplazó `collection:*`; `case:assign` y `case:close` no tienen reemplazo) ──
DELETE FROM "role_permissions"
WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('case:read', 'case:write', 'case:assign', 'case:close', 'case:export'));
DELETE FROM "user_permission_overrides"
WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "code" IN ('case:read', 'case:write', 'case:assign', 'case:close', 'case:export'));
DELETE FROM "permissions" WHERE "code" IN ('case:read', 'case:write', 'case:assign', 'case:close', 'case:export');
