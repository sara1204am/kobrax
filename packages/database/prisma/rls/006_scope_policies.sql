-- Kobrax · Segunda barrera de RLS: alcance DENTRO de la empresa (F14 · F2b, N-01)
--
-- `001_enable_rls.sql` aísla una empresa de otra; este script agrega, por tabla, una policy RESTRICTIVA de SELECT que acota las filas
-- al alcance de la persona (`app.scope`: account | subtree | branch | own | system). Se combina con `tenant_isolation` por AND.
--
-- ⚠️ Es una BARRERA, no la regla: la regla fina la sigue aplicando la API (`moraAccessConditions`, `visibleClientIdsSql`, …). Estas
-- funciones son un SUPERCONJUNTO de esa regla —acotadas por oficina, nunca más estrictas— porque su trabajo es atrapar una consulta
-- que olvidó el filtro, no cambiar resultados legítimos. Además un `INSERT … RETURNING` (Prisma siempre lo usa) también pasa por las
-- policies de SELECT: la fila recién creada debe ser visible para quien la crea.
--
-- Se activa con la variable de transacción `app.scope_mode` (la fija PrismaService desde SCOPE_RLS_MODE):
--   'off'     (por omisión) → las policies dejan pasar todo y NO evalúan la regla;
--   'log'     → evalúa la regla y registra (RAISE LOG) cada fila que habría negado, pero la deja pasar (diagnóstico: ver nota);
--   'enforce' → niega lo que la regla niega.
-- Con 'enforce' una transacción SIN alcance (app.scope vacío) no ve nada: fail-closed.
--
-- Nota del modo 'log': se evalúa por FILA ESCANEADA, no por fila devuelta. Una consulta que ya filtra bien también escanea filas ajenas
-- antes de que su propio filtro las descarte, así que el registro trae falsos positivos. Sirve para diagnosticar, no como medida.
--
-- Aplicar después del 001/002 (db:rls recorre la carpeta en orden). Reaplicable. Rollback: SCOPE_RLS_MODE=off, o
--   DROP POLICY scope_<tabla> ON <tabla>;

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

-- «La oficina está en el subárbol de alguna de MIS asignaciones vigentes» (espejo de `officeInMySubtreeSql`).
CREATE OR REPLACE FUNCTION app_office_in_my_subtree(p_account text, p_branch text) RETURNS boolean AS $$
  SELECT p_branch IS NOT NULL AND EXISTS (
    SELECT 1 FROM user_branch_assignments ab
    JOIN user_accounts uaa ON uaa.user_id = ab.user_id AND uaa.account_id = ab.account_id AND uaa.is_active = true
    JOIN branches mine ON mine.id = ab.branch_id AND mine.account_id = ab.account_id
    JOIN branches ob ON ob.id = p_branch AND ob.account_id = ab.account_id
    WHERE ab.user_id = app_current_user() AND ab.account_id = p_account AND ab.revoked_at IS NULL
      AND ob.path LIKE mine.path || '%');
$$ LANGUAGE sql STABLE;

-- «Estoy asignado a la RAÍZ de la cuenta» (espejo de `assignedToRootSql`).
CREATE OR REPLACE FUNCTION app_assigned_to_root(p_account text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_branch_assignments ar
    JOIN user_accounts uar ON uar.user_id = ar.user_id AND uar.account_id = ar.account_id AND uar.is_active = true
    JOIN branches rb ON rb.id = ar.branch_id AND rb.account_id = ar.account_id AND rb.is_root = true
    WHERE ar.user_id = app_current_user() AND ar.account_id = p_account AND ar.revoked_at IS NULL);
$$ LANGUAGE sql STABLE;

-- «Tengo a cargo el crédito»: responsable, o una asignación vigente (temporal / apoyo).
CREATE OR REPLACE FUNCTION app_credit_mine(p_account text, p_credit text, p_manager text) RETURNS boolean AS $$
  SELECT p_manager = app_current_user() OR EXISTS (
    SELECT 1 FROM credit_assignments ca
    WHERE ca.credit_id = p_credit AND ca.account_id = p_account AND ca.user_id = app_current_user()
      AND ca.revoked_at IS NULL AND ca.starts_at <= now() AND (ca.expires_at IS NULL OR ca.expires_at > now()));
$$ LANGUAGE sql STABLE;

-- Créditos: lo mío, o lo de mi oficina. `branch` NO exige responsable (la API sí; acá es la barrera gruesa y, además, el supervisor
-- tiene que poder leer de vuelta el crédito sin responsable que acaba de crear en su oficina).
CREATE OR REPLACE FUNCTION app_credit_visible(p_account text, p_credit text, p_branch text, p_manager text) RETURNS boolean AS $$
  SELECT CASE app_current_scope()
    WHEN 'account' THEN true
    WHEN 'system'  THEN true
    WHEN 'own'     THEN app_credit_mine(p_account, p_credit, p_manager)
    WHEN 'branch'  THEN app_credit_mine(p_account, p_credit, p_manager) OR app_office_in_my_subtree(p_account, p_branch)
    WHEN 'subtree' THEN app_credit_mine(p_account, p_credit, p_manager) OR app_office_in_my_subtree(p_account, p_branch) OR app_assigned_to_root(p_account)
    ELSE false
  END;
$$ LANGUAGE sql STABLE;

-- Clientes (H-7): el cliente no tiene dueño; se ve por sus créditos visibles, por su oficina de registro, o —sin crédito vivo— por quien
-- lo dio de alta (espejo de `visibleClientIdsSql`).
CREATE OR REPLACE FUNCTION app_client_visible(p_account text, p_client text, p_created_by text, p_registered_branch text) RETURNS boolean AS $$
  SELECT CASE app_current_scope()
    WHEN 'account' THEN true
    WHEN 'system'  THEN true
    WHEN 'own' THEN
      EXISTS (SELECT 1 FROM credits cr WHERE cr.client_id = p_client AND cr.account_id = p_account AND cr.deleted_at IS NULL
                AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
      OR (p_created_by = app_current_user() AND NOT EXISTS (SELECT 1 FROM credits cx WHERE cx.client_id = p_client AND cx.deleted_at IS NULL))
    WHEN 'branch' THEN
      EXISTS (SELECT 1 FROM credits cr WHERE cr.client_id = p_client AND cr.account_id = p_account AND cr.deleted_at IS NULL
                AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
      OR (p_created_by = app_current_user() AND NOT EXISTS (SELECT 1 FROM credits cx WHERE cx.client_id = p_client AND cx.deleted_at IS NULL))
      OR app_office_in_my_subtree(p_account, p_registered_branch)
    WHEN 'subtree' THEN
      EXISTS (SELECT 1 FROM credits cr WHERE cr.client_id = p_client AND cr.account_id = p_account AND cr.deleted_at IS NULL
                AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
      OR (p_created_by = app_current_user() AND NOT EXISTS (SELECT 1 FROM credits cx WHERE cx.client_id = p_client AND cx.deleted_at IS NULL))
      OR app_office_in_my_subtree(p_account, p_registered_branch)
      OR app_assigned_to_root(p_account)
    ELSE false
  END;
$$ LANGUAGE sql STABLE;

-- Pagos: se ven si se ve su crédito (la oficina del PAGO es histórica y no decide nada).
CREATE OR REPLACE FUNCTION app_payment_visible(p_account text, p_credit text) RETURNS boolean AS $$
  SELECT CASE app_current_scope()
    WHEN 'account' THEN true
    WHEN 'system'  THEN true
    WHEN 'own' THEN EXISTS (SELECT 1 FROM credits cr WHERE cr.id = p_credit AND cr.account_id = p_account AND cr.deleted_at IS NULL
                              AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
    WHEN 'branch' THEN EXISTS (SELECT 1 FROM credits cr WHERE cr.id = p_credit AND cr.account_id = p_account AND cr.deleted_at IS NULL
                              AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
    WHEN 'subtree' THEN EXISTS (SELECT 1 FROM credits cr WHERE cr.id = p_credit AND cr.account_id = p_account AND cr.deleted_at IS NULL
                              AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
    ELSE false
  END;
$$ LANGUAGE sql STABLE;

-- Agenda: lo asignado a mí, o lo de un crédito que veo (la API usa lo primero sin `agenda:assign` y lo segundo con él).
CREATE OR REPLACE FUNCTION app_agenda_visible(p_account text, p_credit text, p_assignee text) RETURNS boolean AS $$
  SELECT CASE app_current_scope()
    WHEN 'account' THEN true
    WHEN 'system'  THEN true
    WHEN 'own' THEN p_assignee = app_current_user() OR EXISTS (SELECT 1 FROM credits cr WHERE cr.id = p_credit AND cr.account_id = p_account AND cr.deleted_at IS NULL
                              AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
    WHEN 'branch' THEN p_assignee = app_current_user() OR EXISTS (SELECT 1 FROM credits cr WHERE cr.id = p_credit AND cr.account_id = p_account AND cr.deleted_at IS NULL
                              AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
    WHEN 'subtree' THEN p_assignee = app_current_user() OR EXISTS (SELECT 1 FROM credits cr WHERE cr.id = p_credit AND cr.account_id = p_account AND cr.deleted_at IS NULL
                              AND app_credit_visible(cr.account_id, cr.id, cr.branch_id, cr.assigned_manager_id))
    ELSE false
  END;
$$ LANGUAGE sql STABLE;

-- Rutas: la API NO acota por oficina a quien asigna rutas (los supervisores y gerentes ven todas); sólo el ejecutor de campo ve las suyas.
-- La barrera replica eso: únicamente el alcance `own` queda limitado a sus rutas (las que anda o las que armó).
CREATE OR REPLACE FUNCTION app_route_visible(p_collector text, p_created_by text) RETURNS boolean AS $$
  SELECT CASE app_current_scope()
    WHEN 'account' THEN true
    WHEN 'system'  THEN true
    WHEN 'subtree' THEN true
    WHEN 'branch'  THEN true
    WHEN 'own'     THEN p_collector = app_current_user() OR p_created_by = app_current_user()
    ELSE false
  END;
$$ LANGUAGE sql STABLE;

-- ── Policies (RESTRICTIVE, sólo SELECT: también acotan UPDATE/DELETE, que necesitan leer la fila) ────────────────────────────────
DROP POLICY IF EXISTS scope_credits ON credits;
CREATE POLICY scope_credits ON credits AS RESTRICTIVE FOR SELECT USING (
  CASE app_scope_mode()
    WHEN 'enforce' THEN app_credit_visible(account_id, id, branch_id, assigned_manager_id)
    WHEN 'log'     THEN app_scope_log('credits', id, app_credit_visible(account_id, id, branch_id, assigned_manager_id))
    ELSE true
  END);

DROP POLICY IF EXISTS scope_clients ON clients;
CREATE POLICY scope_clients ON clients AS RESTRICTIVE FOR SELECT USING (
  CASE app_scope_mode()
    WHEN 'enforce' THEN app_client_visible(account_id, id, created_by, registered_branch_id)
    WHEN 'log'     THEN app_scope_log('clients', id, app_client_visible(account_id, id, created_by, registered_branch_id))
    ELSE true
  END);

DROP POLICY IF EXISTS scope_payments ON payments;
CREATE POLICY scope_payments ON payments AS RESTRICTIVE FOR SELECT USING (
  CASE app_scope_mode()
    WHEN 'enforce' THEN app_payment_visible(account_id, credit_id)
    WHEN 'log'     THEN app_scope_log('payments', id, app_payment_visible(account_id, credit_id))
    ELSE true
  END);

DROP POLICY IF EXISTS scope_agenda_items ON agenda_items;
CREATE POLICY scope_agenda_items ON agenda_items AS RESTRICTIVE FOR SELECT USING (
  CASE app_scope_mode()
    WHEN 'enforce' THEN app_agenda_visible(account_id, credit_id, assignee_id)
    WHEN 'log'     THEN app_scope_log('agenda_items', id, app_agenda_visible(account_id, credit_id, assignee_id))
    ELSE true
  END);

DROP POLICY IF EXISTS scope_route_plans ON route_plans;
CREATE POLICY scope_route_plans ON route_plans AS RESTRICTIVE FOR SELECT USING (
  CASE app_scope_mode()
    WHEN 'enforce' THEN app_route_visible(collector_id, created_by)
    WHEN 'log'     THEN app_scope_log('route_plans', id, app_route_visible(collector_id, created_by))
    ELSE true
  END);
