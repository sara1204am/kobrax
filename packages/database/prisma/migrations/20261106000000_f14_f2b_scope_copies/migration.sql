-- F14 · F2b — copias de «de quién es» el crédito, para que la barrera RLS de alcance no consulte `credits` fila por fila.
--
-- POR QUÉ
-- La segunda barrera (`rls/006_scope_policies.sql`) decide qué filas ve cada alcance (propio / oficina / subárbol). Para `payments` y
-- `agenda_items` la regla es «se ve si se ve su crédito», y para `clients` «si se ve alguno de sus créditos». Escrita como un `EXISTS`
-- sobre `credits`, cada fila disparaba una búsqueda que además volvía a pasar por las policies de `credits`: medido con 180.000
-- créditos, los pagos del supervisor pasaban de 10 ms a 290–500 ms. Con la oficina y el responsable COPIADOS en la propia fila, la regla
-- es un filtro local contra un conjunto chico, sin tocar otra tabla.
--
--   payments.credit_branch_id / credit_manager_id        ← credits.branch_id / assigned_manager_id del crédito del pago
--   agenda_items.credit_branch_id / credit_manager_id    ← ídem para el crédito de la tarea
--   clients.scope_manager_ids / scope_branch_ids         ← responsables / oficinas de SUS créditos vivos (deleted_at IS NULL)
--
-- POR QUÉ TRIGGERS Y NO LA APLICACIÓN
-- Mismo criterio que `20260814210000_denormalize_portfolio_totals`: los triggers agarran TODOS los caminos (la API, un import masivo,
-- un UPDATE a mano) y la aplicación se olvidaría en alguno. Las funciones son SECURITY DEFINER (dueño: el rol de migraciones, que
-- ignora RLS) para que el cambio de un crédito actualice TODAS las filas copiadas aunque quien lo dispara tenga un alcance chico.
-- `rls/verify_scope.sql` comprueba que la copia coincide con la verdad (cero filas distintas) y que el dueño de las funciones ignora RLS.
--
-- ⚠️ Una carga masiva con `session_replication_role = replica` apaga estos triggers: después hay que correr el backfill (las dos
-- sentencias UPDATE de abajo, o `rls/verify_scope.sql` lo detecta).
--
-- ROLLBACK: aditivo. `DROP TRIGGER … ; ALTER TABLE … DROP COLUMN …;` y volver a aplicar `rls/006` de la versión anterior.

-- ── Columnas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "payments"
  ADD COLUMN "credit_branch_id"  TEXT,
  ADD COLUMN "credit_manager_id" TEXT;
ALTER TABLE "agenda_items"
  ADD COLUMN "credit_branch_id"  TEXT,
  ADD COLUMN "credit_manager_id" TEXT;
ALTER TABLE "clients"
  ADD COLUMN "scope_manager_ids" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "scope_branch_ids"  TEXT[] NOT NULL DEFAULT '{}';

-- ── Pagos y agenda: la fila copia al nacer y cuando cambia su crédito ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION scope_copy_credit_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT c.branch_id, c.assigned_manager_id INTO NEW.credit_branch_id, NEW.credit_manager_id
  FROM credits c WHERE c.id = NEW.credit_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_scope_copy BEFORE INSERT OR UPDATE OF credit_id ON payments
  FOR EACH ROW EXECUTE FUNCTION scope_copy_credit_owner();
CREATE TRIGGER agenda_items_scope_copy BEFORE INSERT OR UPDATE OF credit_id ON agenda_items
  FOR EACH ROW EXECUTE FUNCTION scope_copy_credit_owner();

-- ── Cuando el crédito cambia de oficina o de responsable, se actualizan sus pagos y su agenda ───────────────────────────────────
CREATE OR REPLACE FUNCTION credits_push_scope_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE payments SET credit_branch_id = NEW.branch_id, credit_manager_id = NEW.assigned_manager_id
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM NEW.branch_id OR credit_manager_id IS DISTINCT FROM NEW.assigned_manager_id);
  UPDATE agenda_items SET credit_branch_id = NEW.branch_id, credit_manager_id = NEW.assigned_manager_id
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM NEW.branch_id OR credit_manager_id IS DISTINCT FROM NEW.assigned_manager_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER credits_scope_push AFTER UPDATE OF branch_id, assigned_manager_id ON credits
  FOR EACH ROW WHEN (OLD.branch_id IS DISTINCT FROM NEW.branch_id OR OLD.assigned_manager_id IS DISTINCT FROM NEW.assigned_manager_id)
  EXECUTE FUNCTION credits_push_scope_owner();

-- ── Clientes: el trigger de totales también mantiene los responsables y las oficinas de sus créditos vivos ───────────────────────
CREATE OR REPLACE FUNCTION portfolio_totals_recalc(target_client_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE clients c
  SET total_debt                 = t.debt,
      max_days_past_due          = t.dpd,
      credit_count               = t.n,
      total_debt_external        = t.debt_ext,
      max_days_past_due_external = t.dpd_ext,
      scope_manager_ids          = t.managers,
      scope_branch_ids           = t.branches
  FROM (
    SELECT COALESCE(SUM(outstanding_balance), 0)::numeric(14,2)                                      AS debt,
           COALESCE(MAX(days_past_due), 0)::int                                                      AS dpd,
           COUNT(*)::int                                                                             AS n,
           COALESCE(SUM(outstanding_balance) FILTER (WHERE origin IN ('IMPORT', 'API')), 0)::numeric(14,2) AS debt_ext,
           COALESCE(MAX(days_past_due) FILTER (WHERE origin IN ('IMPORT', 'API')), 0)::int                 AS dpd_ext,
           COALESCE(array_agg(DISTINCT assigned_manager_id) FILTER (WHERE assigned_manager_id IS NOT NULL), '{}') AS managers,
           COALESCE(array_agg(DISTINCT branch_id) FILTER (WHERE branch_id IS NOT NULL), '{}')                     AS branches
    FROM credits
    WHERE client_id = target_client_id AND deleted_at IS NULL
  ) t
  WHERE c.id = target_client_id
    AND (c.total_debt, c.max_days_past_due, c.credit_count, c.total_debt_external, c.max_days_past_due_external, c.scope_manager_ids, c.scope_branch_ids)
        IS DISTINCT FROM (t.debt, t.dpd, t.n, t.debt_ext, t.dpd_ext, t.managers, t.branches);
$$;

-- El trigger de UPDATE tiene que mirar también la oficina y el responsable (antes sólo saldo, mora, cliente, baja y origen).
DROP TRIGGER IF EXISTS credits_totals_upd ON credits;
CREATE TRIGGER credits_totals_upd AFTER UPDATE OF outstanding_balance, days_past_due, client_id, deleted_at, origin, branch_id, assigned_manager_id ON credits
  FOR EACH ROW WHEN (
    OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance OR OLD.days_past_due IS DISTINCT FROM NEW.days_past_due
    OR OLD.client_id IS DISTINCT FROM NEW.client_id OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at OR OLD.origin IS DISTINCT FROM NEW.origin
    OR OLD.branch_id IS DISTINCT FROM NEW.branch_id OR OLD.assigned_manager_id IS DISTINCT FROM NEW.assigned_manager_id)
  EXECUTE FUNCTION credits_touch_client_totals();

-- ── Backfill (una sola vez; lo que ya existe) ───────────────────────────────────────────────────────────────────────────────────
UPDATE payments p SET credit_branch_id = c.branch_id, credit_manager_id = c.assigned_manager_id
FROM credits c WHERE c.id = p.credit_id;
UPDATE agenda_items a SET credit_branch_id = c.branch_id, credit_manager_id = c.assigned_manager_id
FROM credits c WHERE c.id = a.credit_id;
UPDATE clients cl SET scope_manager_ids = s.managers, scope_branch_ids = s.branches
FROM (
  SELECT client_id,
         COALESCE(array_agg(DISTINCT assigned_manager_id) FILTER (WHERE assigned_manager_id IS NOT NULL), '{}') AS managers,
         COALESCE(array_agg(DISTINCT branch_id) FILTER (WHERE branch_id IS NOT NULL), '{}')                     AS branches
  FROM credits WHERE deleted_at IS NULL GROUP BY client_id
) s WHERE cl.id = s.client_id;

-- ── Índice: «los créditos de esta persona responsable» (la barrera de `own` y los listados del cobrador lo recorren) ──────────────
CREATE INDEX "credits_account_assigned_manager_active_idx" ON "credits" ("account_id", "assigned_manager_id") WHERE "deleted_at" IS NULL;
