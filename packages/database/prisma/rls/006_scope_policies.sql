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

-- JIT apagado para el rol de la API. Con las policies instaladas el planificador estima costos altos en consultas que en realidad son
-- baratas (subplanes de las policies) y dispara el JIT de Postgres: compilar ~100 funciones tardaba 1,3 s en una consulta de 40 ms.
-- Apagarlo es lo habitual en cargas OLTP como ésta (consultas cortas y muchas); no cambia ningún resultado.
ALTER ROLE kobrax_app SET jit = off;

-- 🔴 EL ROL DE LA BARRERA. Las policies de alcance se aplican SÓLO al rol `kobrax_scoped`. La API (PrismaService.runScoped) cambia a ese rol
-- (`SET LOCAL ROLE`, que se deshace al terminar la transacción) únicamente cuando el modo no es `off` Y el alcance es restringido
-- (propio / oficina / subárbol / vacío). Quien tiene alcance de toda la cuenta o de sistema —y todo el sistema con el modo `off`— sigue
-- como `kobrax_app`, sobre el que NO hay ninguna policy de alcance: costo cero. Medido con 180.000 créditos: con la policy aplicada a
-- todos, aun sin filtrar nada, el administrador pagaba ×1,3 a ×3 en los listados (la policy referencia columnas y el planificador
-- pierde los index-only scans de los conteos).
-- Sin BYPASSRLS: el rol cumple tenant_isolation igual que kobrax_app. Sin login: sólo se llega a él con SET ROLE desde kobrax_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_scoped') THEN
    CREATE ROLE kobrax_scoped NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
-- 🔴 NOINHERIT: una policy `TO kobrax_scoped` se aplica también a quien HEREDA ese rol. kobrax_app es miembro (hace falta para el SET ROLE),
-- así que sin esto la policy le tocaría igual y el rol separado no serviría de nada (medido: el administrador seguía pagando ×1,4–2).
-- Con NOINHERIT conserva el SET ROLE pero no hereda privilegios ni policies. kobrax_app no tiene ninguna otra membresía de la que dependa.
-- Va ANTES del GRANT: en PostgreSQL 16+ la opción INHERIT de la membresía se fija al otorgarla, y para entonces ya se pide explícita.
ALTER ROLE kobrax_app NOINHERIT;
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE 'GRANT kobrax_scoped TO kobrax_app WITH INHERIT FALSE, SET TRUE';
  ELSE
    EXECUTE 'GRANT kobrax_scoped TO kobrax_app';
  END IF;
END $$;

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

-- «La barrera no acota esta transacción»: modo apagado, o alcance de toda la cuenta / del sistema. Es UN solo booleano a propósito:
-- comparar parámetros sueltos (`$1 = 'off' OR $2 = ANY(…)`) le hace creer al planificador que casi ninguna fila sobrevive (selectividad
-- mínima por parámetro desconocido), y con esa estimación elige planes malos (medido: pagos del supervisor 5 ms → 320 ms). Un booleano
-- se estima en ~50 %, que es la estimación sensata para una policy de la que no se sabe nada.
CREATE OR REPLACE FUNCTION app_scope_open() RETURNS boolean AS $$
  SELECT app_scope_mode() = 'off' OR app_current_scope() IN ('account', 'system');
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

-- Los mismos conjuntos como ARREGLO: `col = ANY ((SELECT app_my_…_arr()))` se calcula una vez (InitPlan) y por fila compara contra un
-- arreglo chico en vez de buscar en una tabla hash (más barato cuando el conjunto tiene pocas oficinas / pocas asignaciones).
CREATE OR REPLACE FUNCTION app_my_assigned_credit_arr() RETURNS text[] AS $$
  SELECT COALESCE(array_agg(x), '{}') FROM app_my_assigned_credit_ids() x;
$$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_my_subtree_branch_arr() RETURNS text[] AS $$
  SELECT COALESCE(array_agg(x), '{}') FROM app_my_subtree_branch_ids() x;
$$ LANGUAGE sql STABLE;


-- ── Policies (RESTRICTIVE, sólo SELECT: también acotan UPDATE/DELETE, que necesitan leer la fila) ────────────────────────────────
-- Forma común:  off → pasa;  si no, la regla;  y en 'log', lo que la regla niega se registra y pasa.
--
-- 🔴 La regla se escribe UNA RAMA POR ALCANCE y en orden de más a menos selectiva: Postgres evalúa el OR de izquierda a derecha y corta
-- en la primera rama verdadera, así que a una fila de `subtree` no se le pregunta por «mis créditos asignados» antes que por su oficina.

-- Créditos.
CREATE POLICY scope_credits ON credits AS RESTRICTIVE FOR SELECT TO kobrax_scoped USING (
  (SELECT app_scope_open())
  OR ((SELECT app_current_scope()) = 'own' AND (
        assigned_manager_id = (SELECT app_current_user())
     OR id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_current_scope()) = 'branch' AND (
        branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR assigned_manager_id = (SELECT app_current_user())
     OR id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_current_scope()) = 'subtree' AND (
        (SELECT app_assigned_to_root_now())
     OR branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR assigned_manager_id = (SELECT app_current_user())
     OR id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('credits', id, false))
);

-- Pagos y agenda: se ven si se ve su crédito. La regla NO consulta `credits` por fila (esa subconsulta volvía a pasar por las policies
-- de `credits` y duplicaba el costo): usa la oficina y el responsable del crédito COPIADOS en la propia fila (`credit_branch_id`,
-- `credit_manager_id`, ver la migración `20261106000000_f14_f2b_scope_copies` y `…010000_…_live_only`, que los mantienen con triggers). La oficina del PAGO
-- (`branch_id`) es histórica y no decide nada.
CREATE POLICY scope_payments ON payments AS RESTRICTIVE FOR SELECT TO kobrax_scoped USING (
  (SELECT app_scope_open())
  OR ((SELECT app_current_scope()) = 'own' AND (
        credit_manager_id = (SELECT app_current_user())
     OR credit_id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_current_scope()) = 'branch' AND (
        credit_branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR credit_manager_id = (SELECT app_current_user())
     OR credit_id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_current_scope()) = 'subtree' AND (
        (SELECT app_assigned_to_root_now())
     OR credit_branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR credit_manager_id = (SELECT app_current_user())
     OR credit_id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('payments', id, false))
);

-- Agenda: lo asignado a mí, o lo de un crédito que veo (la API usa lo primero sin `agenda:assign` y lo segundo con él).
CREATE POLICY scope_agenda_items ON agenda_items AS RESTRICTIVE FOR SELECT TO kobrax_scoped USING (
  (SELECT app_scope_open())
  OR ((SELECT app_current_scope()) = 'own' AND (
        assignee_id = (SELECT app_current_user())
     OR credit_manager_id = (SELECT app_current_user())
     OR credit_id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_current_scope()) = 'branch' AND (
        assignee_id = (SELECT app_current_user())
     OR credit_branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR credit_manager_id = (SELECT app_current_user())
     OR credit_id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_current_scope()) = 'subtree' AND (
        (SELECT app_assigned_to_root_now())
     OR assignee_id = (SELECT app_current_user())
     OR credit_branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR credit_manager_id = (SELECT app_current_user())
     OR credit_id = ANY ((SELECT app_my_assigned_credit_arr())::text[])))
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('agenda_items', id, false))
);

-- Clientes: se ven por sus créditos (responsable u oficina copiados en `clients.scope_*`, ver la migración), por su oficina de registro,
-- por una asignación temporal de alguno de sus créditos, o —sin crédito vivo— por quien lo dio de alta (`visibleClientIdsSql`).
-- Antes era un `EXISTS` sobre `credits` por fila: cada búsqueda volvía a pasar por las policies de `credits`, y el planificador, al
-- estimar ese costo, disparaba el JIT y descartaba los índices (medido: 38 ms → 1.300 ms sólo por tener la policy instalada).
CREATE OR REPLACE FUNCTION app_my_assigned_client_arr() RETURNS text[] AS $$
  SELECT COALESCE(array_agg(DISTINCT cr.client_id), '{}') FROM credits cr
  WHERE cr.deleted_at IS NULL AND cr.id IN (SELECT app_my_assigned_credit_ids());
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;
REVOKE ALL ON FUNCTION app_my_assigned_client_arr() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_my_assigned_client_arr() TO kobrax_app;

CREATE POLICY scope_clients ON clients AS RESTRICTIVE FOR SELECT TO kobrax_scoped USING (
  (SELECT app_scope_open())
  OR ((SELECT app_current_scope()) = 'own' AND (
        (SELECT app_current_user()) = ANY (scope_manager_ids)
     OR id = ANY ((SELECT app_my_assigned_client_arr())::text[])
     OR (credit_count = 0 AND created_by = (SELECT app_current_user()))))
  OR ((SELECT app_current_scope()) = 'branch' AND (
        registered_branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR scope_branch_ids && (SELECT app_my_subtree_branch_arr())
     OR (SELECT app_current_user()) = ANY (scope_manager_ids)
     OR id = ANY ((SELECT app_my_assigned_client_arr())::text[])
     OR (credit_count = 0 AND created_by = (SELECT app_current_user()))))
  OR ((SELECT app_current_scope()) = 'subtree' AND (
        (SELECT app_assigned_to_root_now())
     OR registered_branch_id = ANY ((SELECT app_my_subtree_branch_arr())::text[])
     OR scope_branch_ids && (SELECT app_my_subtree_branch_arr())
     OR (SELECT app_current_user()) = ANY (scope_manager_ids)
     OR id = ANY ((SELECT app_my_assigned_client_arr())::text[])
     OR (credit_count = 0 AND created_by = (SELECT app_current_user()))))
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('clients', id, false))
);

-- Rutas: la API NO acota por oficina a quien asigna rutas (los supervisores y gerentes ven todas); sólo el ejecutor de campo ve las suyas.
-- La barrera replica eso: únicamente el alcance `own` queda limitado a sus rutas (las que anda o las que armó).
CREATE POLICY scope_route_plans ON route_plans AS RESTRICTIVE FOR SELECT TO kobrax_scoped USING (
  (SELECT app_scope_open())
  OR (SELECT app_current_scope()) IN ('subtree', 'branch')
  OR ((SELECT app_current_scope()) = 'own' AND (collector_id = (SELECT app_current_user()) OR created_by = (SELECT app_current_user())))
  OR ((SELECT app_scope_mode()) = 'log' AND app_scope_log('route_plans', id, false))
);

-- ── Permisos de `kobrax_scoped` = los de `kobrax_app` (copiados, no escritos a mano) ───────────────────────────────────────────────
-- Las concesiones de `kobrax_app` están repartidas en 001–005 y en lo que agreguen las migraciones; duplicarlas a mano en un segundo rol
-- dejaría, el día que alguien agregue una tabla, a los usuarios con alcance restringido con «permission denied» y a los demás sin
-- problema. Por eso se copian al final de este script (db:rls lo corre último, después de cada migración). `verify_scope.sql` y el
-- arranque de la API comprueban que no falte nada.
-- Tablas y secuencias FUTURAS: mismos privilegios por omisión que `rebuild.ts` da a kobrax_app, para que una migración que cree una tabla no deje
-- a los usuarios con alcance restringido con «permission denied» hasta la próxima corrida de db:rls.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kobrax_scoped;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kobrax_scoped;

DO $$
DECLARE r record; app_oid oid := (SELECT oid FROM pg_roles WHERE rolname = 'kobrax_app');
BEGIN
  GRANT USAGE ON SCHEMA public TO kobrax_scoped;
  FOR r IN SELECT table_name AS t, privilege_type AS p FROM information_schema.role_table_grants WHERE grantee = 'kobrax_app' AND table_schema = 'public' LOOP
    EXECUTE format('GRANT %s ON %I TO kobrax_scoped', r.p, r.t);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, LATERAL aclexplode(p.proacl) a
           WHERE n.nspname = 'public' AND a.grantee = app_oid AND a.privilege_type = 'EXECUTE' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO kobrax_scoped', r.f);
  END LOOP;
  FOR r IN SELECT c.oid::regclass AS sq, a.privilege_type AS p FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
           WHERE n.nspname = 'public' AND c.relkind = 'S' AND a.grantee = app_oid LOOP
    EXECUTE format('GRANT %s ON SEQUENCE %s TO kobrax_scoped', r.p, r.sq);
  END LOOP;
END $$;
