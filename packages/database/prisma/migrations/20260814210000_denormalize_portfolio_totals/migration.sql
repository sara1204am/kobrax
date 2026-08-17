-- Cartera: los tres agregados pasan a vivir en `clients`, mantenidos por un TRIGGER.
--
-- POR QUÉ
-- La cartera ordena y filtra por la suma del saldo y la peor mora de cada persona. Ordenar por un
-- agregado obliga a calcular TODOS los grupos antes de saber cuáles son los 50 primeros: no hay
-- índice que lo evite —se probó uno cubridor sobre `credits(account_id, client_id)` y el planner no
-- lo usa, porque necesita todas las filas igual—.
--
-- Medido con `prisma/seed-perf.sql` (100.000 personas · 300.000 créditos):
--   primera página, orden por mora ...... 768 ms  →  0,43 ms
--   mora >= 90 AND deuda >= 10.000 ...... 660 ms  →  0,49 ms
--   página profunda (offset 5.000) ...... 570 ms  →  1,0 ms
--
-- POR QUÉ UN TRIGGER Y NO LA APLICACIÓN
-- Porque agarra TODOS los caminos: el alta desde el móvil, el `updateMany` del import, el recálculo
-- de mora, y el `UPDATE` a mano de alguien arreglando algo un martes. Mantenerlo desde el servicio
-- obligaría a acordarse en cinco lugares hoy y en el próximo módulo mañana — y el día que uno se
-- olvide, la cartera muestra un saldo que no es, sin que nada falle.
--
-- POR QUÉ NO UNA VISTA MATERIALIZADA
-- Porque haría falta refrescarla, y la cartera no puede quedar vieja: un pago tiene que mover la
-- fila en el acto. Una vista con `REFRESH` cada N minutos es una cartera que miente durante N
-- minutos, justo sobre plata.

ALTER TABLE "clients"
  ADD COLUMN "total_debt" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "max_days_past_due" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "credit_count" INTEGER NOT NULL DEFAULT 0;

/*
 * Recalcula los tres números de UN cliente, leyendo sus créditos vivos.
 *
 * Recalcula en vez de sumar diferencias porque `MAX(days_past_due)` no se puede mantener de a
 * poco: si baja la mora del crédito que era el máximo, hay que volver a mirar los otros. Es una
 * lectura por índice sobre los 1..5 créditos de una persona, no un recorrido de la cartera.
 *
 * `SECURITY DEFINER` a propósito: `clients` tiene RLS con FORCE, y este UPDATE tiene que poder
 * correr también cuando el cambio en `credits` viene de un contexto donde el cliente no sería
 * visible (un job, un backfill). El `search_path` fijo es la contracara obligatoria de eso: sin él,
 * quien pueda crear un esquema propio podría hacerle ejecutar otra cosa.
 */
CREATE OR REPLACE FUNCTION portfolio_totals_recalc(target_client_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE clients c
  SET total_debt        = t.debt,
      max_days_past_due = t.dpd,
      credit_count      = t.n
  FROM (
    SELECT COALESCE(SUM(outstanding_balance), 0)::numeric(14,2) AS debt,
           COALESCE(MAX(days_past_due), 0)::int                 AS dpd,
           COUNT(*)::int                                        AS n
    FROM credits
    WHERE client_id = target_client_id AND deleted_at IS NULL
  ) t
  WHERE c.id = target_client_id
    -- Sin esto, cada recálculo escribe la misma fila de nuevo: filas muertas para el vacuum y un
    -- `updated_at` que cambia sin que nadie haya cambiado nada.
    AND (c.total_debt, c.max_days_past_due, c.credit_count) IS DISTINCT FROM (t.debt, t.dpd, t.n);
$$;

CREATE OR REPLACE FUNCTION credits_touch_client_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- En un cambio de dueño hay DOS clientes que quedaron mal: el que perdió el crédito y el que lo
  -- ganó. Es raro, pero si pasa y sólo se recalcula uno, el otro queda con un saldo fantasma.
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
    PERFORM portfolio_totals_recalc(OLD.client_id);
  END IF;
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    PERFORM portfolio_totals_recalc(NEW.client_id);
  END IF;
  RETURN NULL; -- AFTER trigger: lo que devuelva no se usa
END;
$$;

/*
 * Sólo lo que mueve los números.
 *
 * El `UPDATE OF` limita a esas cuatro columnas y el `WHEN` descarta el cambio que no cambia nada:
 * el import hace `updateMany` sobre miles de créditos y la mayoría vuelve a escribir el mismo
 * valor. Sin esas dos guardas, cada corrida dispararía miles de recálculos para dejar todo igual.
 */
CREATE TRIGGER credits_totals_ins
  AFTER INSERT ON credits
  FOR EACH ROW EXECUTE FUNCTION credits_touch_client_totals();

CREATE TRIGGER credits_totals_upd
  AFTER UPDATE OF outstanding_balance, days_past_due, client_id, deleted_at ON credits
  FOR EACH ROW
  WHEN (
    OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance
    OR OLD.days_past_due IS DISTINCT FROM NEW.days_past_due
    OR OLD.client_id IS DISTINCT FROM NEW.client_id
    OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
  )
  EXECUTE FUNCTION credits_touch_client_totals();

CREATE TRIGGER credits_totals_del
  AFTER DELETE ON credits
  FOR EACH ROW EXECUTE FUNCTION credits_touch_client_totals();

-- Backfill: los que ya estaban. En una sola pasada, no cliente por cliente.
UPDATE clients c
SET total_debt        = t.debt,
    max_days_past_due = t.dpd,
    credit_count      = t.n
FROM (
  SELECT cl.id,
         COALESCE(SUM(cr.outstanding_balance), 0)::numeric(14,2) AS debt,
         COALESCE(MAX(cr.days_past_due), 0)::int                 AS dpd,
         COUNT(cr.id)::int                                       AS n
  FROM clients cl
  LEFT JOIN credits cr ON cr.client_id = cl.id AND cr.deleted_at IS NULL
  GROUP BY cl.id
) t
WHERE c.id = t.id;

-- Los dos órdenes con los que abre la cartera, con el desempate por `id` adentro: va en el
-- `ORDER BY`, y sin él `LIMIT/OFFSET` repite o saltea filas entre página y página.
CREATE INDEX "clients_account_id_max_days_past_due_total_debt_id_idx"
  ON "clients" ("account_id", "max_days_past_due" DESC, "total_debt" DESC, "id");
CREATE INDEX "clients_account_id_total_debt_id_idx"
  ON "clients" ("account_id", "total_debt" DESC, "id");

GRANT EXECUTE ON FUNCTION portfolio_totals_recalc(text) TO kobrax_app;
