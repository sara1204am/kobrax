-- Kobrax · Segunda barrera de RLS: alcance DENTRO de la empresa (F14 · F2b, N-01)
--
-- `001_enable_rls.sql` aísla una empresa de otra; este script agrega, por tabla, una policy RESTRICTIVA de SELECT que acota las filas
-- al alcance de la persona (`app.scope`: account | subtree | branch | own | system). Se combina con `tenant_isolation` por AND.
--
-- ⚠️ Es una BARRERA, no la regla: la regla fina la sigue aplicando la API (`moraAccessConditions`, `visibleClientIdsSql`, …). Lo de acá
-- es un SUPERCONJUNTO de esa regla —acotado por oficina, nunca más estricto— porque su trabajo es atrapar una consulta que olvidó el
-- filtro, no cambiar resultados legítimos. Además un `INSERT … RETURNING` (Prisma siempre lo usa) también pasa por las policies de
-- SELECT: la fila recién creada debe ser visible para quien la crea.
--
-- Se activa con la variable de transacción `app.scope_mode` (la fija PrismaService desde SCOPE_RLS_MODE):
--   'off'     (por omisión) → las policies dejan pasar todo y NO evalúan la regla;
--   'log'     → evalúa la regla y registra (RAISE LOG) cada fila que habría negado, pero la deja pasar (diagnóstico: ver nota);
--   'enforce' → niega lo que la regla niega.
-- Con 'enforce' una transacción SIN alcance (app.scope vacío) no ve nada: fail-closed.
--
-- 🔴 RENDIMIENTO (D-4). Una función SQL con subconsultas NO se inlinea y Postgres la llama FILA POR FILA (medido: ×3 sobre 300 000
-- créditos). Por eso la regla no se escribe como función de la fila: se escribe con CONJUNTOS sin correlación —los créditos que me
-- asignaron, las oficinas de mi subárbol— que el planificador calcula UNA vez por consulta (hashed SubPlan / InitPlan) y contra los que
-- cada fila sólo hace una búsqueda en una tabla hash. Todo lo que no depende de la fila va envuelto en `(SELECT …)` para que se evalúe
-- una sola vez.
--
-- Nota del modo 'log': se evalúa por FILA ESCANEADA, no por fila devuelta. Una consulta que ya filtra bien también escanea filas ajenas
-- antes de que su propio filtro las descarte, así que el registro trae falsos positivos. Sirve para diagnosticar, no como medida.
--
-- Aplicar después del 001/002 (db:rls recorre la carpeta en orden). Reaplicable. Rollback: SCOPE_RLS_MODE=off, o
--   DROP POLICY scope_<tabla> ON <tabla>;

-- Funciones de versiones anteriores de este script (la regla por fila): se retiran junto con las policies que las usaban.
DROP POLICY IF EXISTS scope_credits ON credits;
DROP POLICY IF EXISTS scope_clients ON clients;
DROP POLICY IF EXISTS scope_payments ON payments;
DROP POLICY IF EXISTS scope_agenda_items ON agenda_items;
DROP POLICY IF EXISTS scope_route_plans ON route_plans;
DROP FUNCTION IF EXISTS app_credit_visible(text, text, text, text);
DROP FUNCTION IF EXISTS app_client_visible(text, text, text, text);
DROP FUNCTION IF EXISTS app_payment_visible(text, text);
DROP FUNCTION IF EXISTS app_agenda_visible(text, text, text);
DROP FUNCTION IF EXISTS app_route_visible(text, text);
DROP FUNCTION IF EXISTS app_credit_mine(text, text, text);
DROP FUNCTION IF EXISTS app_office_in_my_subtree(text, text);
DROP FUNCTION IF EXISTS app_assigned_to_root(text);
DROP FUNCTION IF EXISTS app_visible_credit_ids();
DROP FUNCTION IF EXISTS app_visible_credit_client_ids();

CREATE OR REPLACE FUNCTION app_scope_mode() RETURNS text AS $$
  SELECT COALESCE(NULLIF(current_setting('app.scope_mode', true), ''), 'off');
$$ LANGUAGE sql STABLE;

-- Registra y deja pasar (modo 'log'). VOLATILE a propósito: tiene efecto lateral.
CREATE OR REPLACE FUNCTION app_scope_log(p_table text, p_id text, p_ok boolean) RETURNS boolean AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE LOG 'scope_rls would_deny table=% id=% user=% scope=%', p_table, p_id, app_current_user(), app_current_scope();
  END IF;
  RETURN true;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ── Conjuntos sin correlación (se calculan una vez por consulta) ─────────────────────────────────────────────────────────────

-- Créditos que me asignaron (temporal / apoyo), vigentes.
CREATE OR REPLACE FUNCTION app_my_assigned_credit_ids() RETURNS SETOF text AS $$
  SELECT ca.credit_id FROM credit_assignments ca
  WHERE ca.user_id = app_current_user() AND ca.account_id = app_current_account()
    AND ca.revoked_at IS NULL AND ca.starts_at <= now() AND (ca.expires_at IS NULL OR ca.expires_at > now());
$$ LANGUAGE sql STABLE;

-- Oficinas del subárbol de alguna de MIS asignaciones vigentes (espejo de `officeInMySubtreeSql`).
CREATE OR REPLACE FUNCTION app_my_subtree_branch_ids() RETURNS SETOF text AS $$
  SELECT ob.id FROM user_branch_assignments ab
  JOIN user_accounts uaa ON uaa.user_id = ab.user_id AND uaa.account_id = ab.account_id AND uaa.is_active = true
  JOIN branches mine ON mine.id = ab.branch_id AND mine.account_id = ab.account_id
  JOIN branches ob ON ob.account_id = ab.account_id AND ob.path LIKE mine.path || '%'
  WHERE ab.user_id = app_current_user() AND ab.account_id = app_current_account() AND ab.revoked_at IS NULL;
$$ LANGUAGE sql STABLE;

-- «Estoy asignado a la RAÍZ de la cuenta» (espejo de `assignedToRootSql`).
CREATE OR REPLACE FUNCTION app_assigned_to_root_now() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_branch_assignments ar
    JOIN user_accounts uar ON uar.user_id = ar.user_id AND uar.account_id = ar.account_id AND uar.is_active = true
    JOIN branches rb ON rb.id = ar.branch_id AND rb.account_id = ar.account_id AND rb.is_root = true
    WHERE ar.user_id = app_current_user() AND ar.account_id = app_current_account() AND ar.revoked_at IS NULL);
$$ LANGUAGE sql STABLE;

-- ── Policies (RESTRICTIVE, sólo SELECT: también acotan UPDATE/DELETE, que necesitan leer la fila) ────────────────────────────────
-- Forma común:  off → pasa;  si no, la regla;  y en 'log', lo que la regla niega se registra y pasa.

CREATE POLICY scope_credits ON credits AS RESTRICTIVE FOR SELECT USING (
  (SELECT app_scope_mode()) = 'off'
  OR (
    (SELECT app_current_scope()) IN ('account', 'system')
    OR ((SELECT app_current_scope()) IN ('own', 'branch', 'subtree') AND (
         assigned_manager_id = (SELECT app_current_user())
      OR id IN (SELECT app_my_assigned_credit_ids())
      OR ((SELECT app_current_scope()) IN ('branch', 'subtree') AND branch_id IN (SELECT app_my_subtree_branch_ids()))
      OR ((SELECT app_current_scope()) = 'subtree' AND (SELECT app_assigned_to_root_now()))
    ))
  )
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('credits', id, false))
);

-- Clientes: por sus créditos visibles, por su oficina de registro, o —sin crédito vivo— por quien lo dio de alta (`visibleClientIdsSql`).
CREATE POLICY scope_clients ON clients AS RESTRICTIVE FOR SELECT USING (
  (SELECT app_scope_mode()) = 'off'
  OR (
    (SELECT app_current_scope()) IN ('account', 'system')
    OR ((SELECT app_current_scope()) IN ('own', 'branch', 'subtree') AND (
         EXISTS (SELECT 1 FROM credits cr WHERE cr.client_id = clients.id AND cr.deleted_at IS NULL AND (
        cr.assigned_manager_id = (SELECT app_current_user())
        OR cr.id IN (SELECT app_my_assigned_credit_ids())
        OR ((SELECT app_current_scope()) IN ('branch', 'subtree') AND cr.branch_id IN (SELECT app_my_subtree_branch_ids()))
        OR ((SELECT app_current_scope()) = 'subtree' AND (SELECT app_assigned_to_root_now()))
      ))
      OR (created_by = (SELECT app_current_user()) AND NOT EXISTS (SELECT 1 FROM credits cx WHERE cx.client_id = clients.id AND cx.deleted_at IS NULL))
      OR ((SELECT app_current_scope()) IN ('branch', 'subtree') AND registered_branch_id IN (SELECT app_my_subtree_branch_ids()))
      OR ((SELECT app_current_scope()) = 'subtree' AND (SELECT app_assigned_to_root_now()))
    ))
  )
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('clients', id, false))
);

-- Pagos: se ven si se ve su crédito (la oficina del PAGO es histórica y no decide nada).
CREATE POLICY scope_payments ON payments AS RESTRICTIVE FOR SELECT USING (
  (SELECT app_scope_mode()) = 'off'
  OR (
    (SELECT app_current_scope()) IN ('account', 'system')
    OR ((SELECT app_current_scope()) IN ('own', 'branch', 'subtree') AND EXISTS (SELECT 1 FROM credits cr WHERE cr.id = payments.credit_id AND cr.deleted_at IS NULL AND (
        cr.assigned_manager_id = (SELECT app_current_user())
        OR cr.id IN (SELECT app_my_assigned_credit_ids())
        OR ((SELECT app_current_scope()) IN ('branch', 'subtree') AND cr.branch_id IN (SELECT app_my_subtree_branch_ids()))
        OR ((SELECT app_current_scope()) = 'subtree' AND (SELECT app_assigned_to_root_now()))
      )))
  )
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('payments', id, false))
);

-- Agenda: lo asignado a mí, o lo de un crédito que veo (la API usa lo primero sin `agenda:assign` y lo segundo con él).
CREATE POLICY scope_agenda_items ON agenda_items AS RESTRICTIVE FOR SELECT USING (
  (SELECT app_scope_mode()) = 'off'
  OR (
    (SELECT app_current_scope()) IN ('account', 'system')
    OR ((SELECT app_current_scope()) IN ('own', 'branch', 'subtree') AND (
         assignee_id = (SELECT app_current_user())
      OR EXISTS (SELECT 1 FROM credits cr WHERE cr.id = agenda_items.credit_id AND cr.deleted_at IS NULL AND (
        cr.assigned_manager_id = (SELECT app_current_user())
        OR cr.id IN (SELECT app_my_assigned_credit_ids())
        OR ((SELECT app_current_scope()) IN ('branch', 'subtree') AND cr.branch_id IN (SELECT app_my_subtree_branch_ids()))
        OR ((SELECT app_current_scope()) = 'subtree' AND (SELECT app_assigned_to_root_now()))
      ))
    ))
  )
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('agenda_items', id, false))
);

-- Rutas: la API NO acota por oficina a quien asigna rutas (los supervisores y gerentes ven todas); sólo el ejecutor de campo ve las suyas.
-- La barrera replica eso: únicamente el alcance `own` queda limitado a sus rutas (las que anda o las que armó).
CREATE POLICY scope_route_plans ON route_plans AS RESTRICTIVE FOR SELECT USING (
  (SELECT app_scope_mode()) = 'off'
  OR (
    (SELECT app_current_scope()) IN ('account', 'system', 'subtree', 'branch')
    OR ((SELECT app_current_scope()) = 'own' AND (collector_id = (SELECT app_current_user()) OR created_by = (SELECT app_current_user())))
  )
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('route_plans', id, false))
);
