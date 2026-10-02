-- Central de Mora (F4/07 · T11a): el historial de mora que no existía.
--
-- `credits.days_past_due` sólo dice cuántos días lleva HOY, y `arrears` es una foto que se borra y se
-- reescribe. Para saber «cuándo empezó esta mora, hasta dónde llegó y cómo terminó» no había nada:
-- sólo los casos (`collection_cases`), que existen si el trabajo diario los abrió.
--
-- Esta migración crea `credit_arrear_episodes` y un TRIGGER sobre `credits` que la mantiene, más un
-- backfill de lo que ya se puede saber. Idempotente en lo que se puede (`IF NOT EXISTS`, `OR REPLACE`,
-- `NOT EXISTS`).
--
-- ⚠️ Esta migración NO escribe la policy de RLS (igual que `credit_assignments`). Se activa con
-- `prisma/rls/001_enable_rls.sql`, que ya lista la tabla: volver a correrla después de aplicar esto.

-- ── 1 · Tipos y tabla ───────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "arrear_episode_end" AS ENUM ('PAID', 'CURRENT', 'SOURCE_ABSENT', 'WRITTEN_OFF', 'CANCELLED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "arrear_episode_source" AS ENUM ('CALCULATED', 'IMPORTED', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "credit_arrear_episodes" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "started_at" DATE NOT NULL,
    "started_at_estimated" BOOLEAN NOT NULL DEFAULT true,
    "ended_at" DATE,
    "end_reason" "arrear_episode_end",
    "start_days_past_due" INTEGER,
    "max_days_past_due" INTEGER,
    "balance_at_start" DECIMAL(14,2),
    "balance_at_end" DECIMAL(14,2),
    "source" "arrear_episode_source" NOT NULL,
    "reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_arrear_episodes_pkey" PRIMARY KEY ("id"),
    -- Un episodio no termina antes de empezar, y «cerrado» y «motivo» van juntos.
    CONSTRAINT "credit_arrear_episodes_fechas_coherentes" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
    CONSTRAINT "credit_arrear_episodes_cierre_coherente" CHECK (("ended_at" IS NULL) = ("end_reason" IS NULL))
);

CREATE INDEX IF NOT EXISTS "credit_arrear_episodes_account_id_credit_id_started_at_idx"
    ON "credit_arrear_episodes"("account_id", "credit_id", "started_at" DESC);

DO $$ BEGIN
  ALTER TABLE "credit_arrear_episodes" ADD CONSTRAINT "credit_arrear_episodes_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "credit_arrear_episodes" ADD CONSTRAINT "credit_arrear_episodes_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A lo sumo UN episodio abierto por crédito. Prisma no expresa el WHERE: sólo en SQL.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_arrear_episodes_one_open_per_credit"
    ON "credit_arrear_episodes"("credit_id") WHERE "ended_at" IS NULL;

-- ── 2 · Reglas de derivación, escritas UNA vez ──────────────────────────────────────────────────
-- Las usan el trigger y el backfill. Son funciones puras (IMMUTABLE): sólo miran lo que reciben.

-- De quién es la mora. Misma regla que `arrearsSourceOf` (shared): externo → IMPORTED; si no, MANUAL
-- cuando alguien declaró `moraSince`, y CALCULATED en el resto.
CREATE OR REPLACE FUNCTION arrear_episode_source_of(origin text, metadata jsonb)
RETURNS "arrear_episode_source"
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN origin IN ('IMPORT', 'API') THEN 'IMPORTED'::"arrear_episode_source"
    WHEN metadata->>'moraSince' IS NOT NULL THEN 'MANUAL'::"arrear_episode_source"
    ELSE 'CALCULATED'::"arrear_episode_source"
  END
$$;

-- La fecha de inicio que alguien DECLARÓ (`moraSince` manual o `arrearsSince` del método bancario), o
-- NULL. Valida el formato antes de castear: un JSON mal escrito no puede tumbar un UPDATE de `credits`.
CREATE OR REPLACE FUNCTION arrear_episode_declared_start(metadata jsonb)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN metadata->>'moraSince' ~ '^\d{4}-\d{2}-\d{2}$' THEN (metadata->>'moraSince')::date
    WHEN metadata->>'arrearsSince' ~ '^\d{4}-\d{2}-\d{2}$' THEN (metadata->>'arrearsSince')::date
    ELSE NULL
  END
$$;

-- ── 3 · El trigger ──────────────────────────────────────────────────────────────────────────────
/*
 * Abre, actualiza y cierra el episodio de un crédito cuando cambia lo que decide si está en mora.
 *
 * «En mora» = vivo (no borrado), con `days_past_due > 0` y en un estado que no es cerrado
 * (PAID / CANCELLED / WRITTEN_OFF). Es la misma definición que usa la Central de Mora para listar.
 *
 *  · Entra en mora → abre un episodio. Si el último terminó por `SOURCE_ABSENT` (el reporte dejó de
 *    traerlo y volvió **todavía en mora**), se REABRE ese mismo, no se abre otro: es la misma regla que
 *    el caso (D4), y un crédito que parpadea en un reporte no puede sumar un «episodio» por cada parpadeo.
 *  · Una operación que pasa a `ABSENT` **en la misma transacción** en que su mora se puso en 0 NO se
 *    «puso al día»: es la regla `set-current` del importador (primero deja la mora en 0, después marca la
 *    ausencia, en dos UPDATE seguidos). El primer UPDATE cierra el episodio como CURRENT; el segundo lo
 *    reclasifica a `SOURCE_ABSENT`. Se reconoce por `updated_at = CURRENT_TIMESTAMP` (el instante de la
 *    transacción): sólo lo tocado en esta misma. Así vale sin depender del orden de las escrituras.
 *  · Una operación que volvió al reporte **al día** resuelve el episodio que había quedado en
 *    `SOURCE_ABSENT`: ahora sí se sabe cómo terminó (CURRENT, o PAID si ya no debe nada). Sin esto, una
 *    mora de dentro de un mes reabriría ese episodio viejo y fusionaría dos periodos distintos.
 *  · Sigue en mora → sólo sube `max_days_past_due`.
 *  · Sale de mora → cierra, con el motivo que se desprende del estado: borrado, castigado, cancelado,
 *    ausente de la fuente (D4: no se sabe cómo terminó, y NO cuenta como recuperación), pagado o al día.
 *
 * `started_at`: la fecha declarada si la hay; si no, corte − días (para un externo el corte es
 * `reported_as_of`, no hoy), marcada como ESTIMADA.
 *
 * `SECURITY DEFINER` + `search_path` fijo por la misma razón que `portfolio_totals_recalc`: la mora
 * cambia desde jobs y backfills donde `credit_arrear_episodes` (RLS con FORCE) podría no ser visible.
 */
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
         AND NEW.status::text NOT IN ('PAID', 'CANCELLED', 'WRITTEN_OFF');

  SELECT id INTO open_id FROM credit_arrear_episodes WHERE credit_id = NEW.id AND ended_at IS NULL;

  IF in_mora THEN
    IF open_id IS NOT NULL THEN
      -- Sigue en mora: sólo registra el pico, y sólo si subió (sin esto cada día reescribiría la fila).
      UPDATE credit_arrear_episodes
         SET max_days_past_due = NEW.days_past_due, updated_at = CURRENT_TIMESTAMP
       WHERE id = open_id AND COALESCE(max_days_past_due, 0) < NEW.days_past_due;
      RETURN NULL;
    END IF;

    -- Volvió después de faltar del reporte: se reabre el mismo episodio.
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

  -- No está en mora: el motivo sale del estado del crédito.
  reason := CASE
    WHEN NEW.deleted_at IS NOT NULL THEN 'DELETED'
    WHEN NEW.status::text = 'WRITTEN_OFF' THEN 'WRITTEN_OFF'
    WHEN NEW.status::text = 'CANCELLED' THEN 'CANCELLED'
    WHEN NEW.sync_status::text = 'ABSENT' THEN 'SOURCE_ABSENT'
    WHEN NEW.status::text = 'PAID' OR NEW.outstanding_balance <= 0.005 THEN 'PAID'
    ELSE 'CURRENT'
  END;

  IF open_id IS NOT NULL THEN
    -- Había un episodio abierto: se cierra.
    UPDATE credit_arrear_episodes
       SET ended_at = GREATEST(CURRENT_DATE, started_at), end_reason = reason,
           balance_at_end = NEW.outstanding_balance, updated_at = CURRENT_TIMESTAMP
     WHERE id = open_id;
  ELSIF NEW.sync_status::text = 'PRESENT' THEN
    -- Volvió al reporte sin mora: el episodio que quedó «ausente» ya tiene desenlace conocido.
    UPDATE credit_arrear_episodes
       SET end_reason = reason, balance_at_end = NEW.outstanding_balance, updated_at = CURRENT_TIMESTAMP
     WHERE credit_id = NEW.id AND end_reason = 'SOURCE_ABSENT';
  ELSIF TG_OP = 'UPDATE' AND NEW.sync_status::text = 'ABSENT' AND OLD.sync_status::text IS DISTINCT FROM 'ABSENT' THEN
    -- Pasó a ausente y su episodio se cerró como «al día» en esta misma transacción: no es una recuperación.
    UPDATE credit_arrear_episodes
       SET end_reason = 'SOURCE_ABSENT', updated_at = CURRENT_TIMESTAMP
     -- `updated_at` es timestamp(3): se compara con el instante de la transacción redondeado igual.
     WHERE credit_id = NEW.id AND end_reason = 'CURRENT' AND updated_at = CURRENT_TIMESTAMP::timestamp(3);
  END IF;
  RETURN NULL; -- AFTER trigger: lo que devuelva no se usa
END;
$$;

/*
 * Sólo lo que decide «en mora o no»: los días, el estado, el borrado y la presencia en la fuente. El
 * saldo no entra (un pago parcial no cambia nada), y el `WHEN` descarta la escritura que no cambia
 * nada — el importador hace `updateMany` sobre miles de créditos que casi todos reescriben lo mismo.
 */
DROP TRIGGER IF EXISTS credits_arrear_episode_ins ON credits;
CREATE TRIGGER credits_arrear_episode_ins
  AFTER INSERT ON credits
  FOR EACH ROW
  WHEN (NEW.days_past_due > 0)
  EXECUTE FUNCTION credits_track_arrear_episode();

DROP TRIGGER IF EXISTS credits_arrear_episode_upd ON credits;
CREATE TRIGGER credits_arrear_episode_upd
  AFTER UPDATE OF days_past_due, status, deleted_at, sync_status ON credits
  FOR EACH ROW
  WHEN (
    OLD.days_past_due IS DISTINCT FROM NEW.days_past_due
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
    OR OLD.sync_status IS DISTINCT FROM NEW.sync_status
  )
  EXECUTE FUNCTION credits_track_arrear_episode();

-- ── 4 · Backfill: lo que ya se puede saber ──────────────────────────────────────────────────────
-- (a) Los créditos que HOY están en mora y todavía no tienen episodio abierto: lo abren con la misma
-- regla del trigger. Su `started_at` es estimado salvo que alguien lo haya declarado.
INSERT INTO credit_arrear_episodes (
  id, account_id, credit_id, started_at, started_at_estimated, start_days_past_due,
  max_days_past_due, balance_at_start, source
)
SELECT gen_random_uuid()::text, c.account_id, c.id,
       COALESCE(arrear_episode_declared_start(c.metadata), COALESCE(c.reported_as_of, CURRENT_DATE) - c.days_past_due),
       arrear_episode_declared_start(c.metadata) IS NULL,
       c.days_past_due, c.days_past_due, c.outstanding_balance,
       arrear_episode_source_of(c.origin::text, c.metadata)
FROM credits c
WHERE c.deleted_at IS NULL
  AND c.days_past_due > 0
  AND c.status::text NOT IN ('PAID', 'CANCELLED', 'WRITTEN_OFF')
  AND NOT EXISTS (SELECT 1 FROM credit_arrear_episodes e WHERE e.credit_id = c.id AND e.ended_at IS NULL);

-- (b) Los episodios ya terminados que dejaron huella en los casos: un caso que el sistema cerró porque
-- la mora terminó (PAID, CURRENT) o porque la fuente dejó de reportarlo (SOURCE_ABSENT). Es lo más cerca
-- que se llega al pasado: empezó cuando se abrió el caso y terminó cuando se cerró. Van marcados
-- `reconstructed` y sin días máximos ni saldos, que nadie midió.
--
-- No se reconstruyen los cerrados a mano (`MANUAL`): cerrar un caso no es que la mora terminara. Y se
-- salta el que se solapa con el episodio abierto del mismo crédito (la mora de hoy ya lo cubre).
INSERT INTO credit_arrear_episodes (
  id, account_id, credit_id, started_at, started_at_estimated, ended_at, end_reason, source, reconstructed
)
SELECT gen_random_uuid()::text, cc.account_id, cc.credit_id,
       cc.created_at::date, true, GREATEST(cc.closed_at::date, cc.created_at::date),
       cc.closed_reason::"arrear_episode_end",
       arrear_episode_source_of(cr.origin::text, cr.metadata), true
FROM collection_cases cc
JOIN credits cr ON cr.id = cc.credit_id
WHERE cc.deleted_at IS NULL
  AND cc.closed_at IS NOT NULL
  AND cc.closed_reason IN ('PAID', 'CURRENT', 'SOURCE_ABSENT')
  AND NOT EXISTS (
    SELECT 1 FROM credit_arrear_episodes e
    WHERE e.credit_id = cc.credit_id
      AND (e.reconstructed AND e.started_at = cc.created_at::date
           OR (e.ended_at IS NULL AND e.started_at <= GREATEST(cc.closed_at::date, cc.created_at::date)))
  );
