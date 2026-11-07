-- Kobrax · Verificación de la segunda barrera de RLS (F14 · F2b). SOLO LEE; se puede correr en cualquier entorno, también en producción.
--
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 < packages/database/prisma/rls/verify_scope.sql
--
-- Cada bloque imprime OK o aborta con la causa. La prueba con datos (qué ve cada alcance) vive en
-- `apps/api/test/integration/f2b-rls-alcance.it.ts`; esto comprueba lo que depende del ENTORNO: que la barrera esté instalada y que los
-- roles sean los esperados.

\set ON_ERROR_STOP on

-- 1. Las cinco policies RESTRICTIVAS de SELECT existen, y las tablas siguen con RLS forzado.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credits','clients','payments','agenda_items','route_plans'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'scope_' || t AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND roles = '{kobrax_scoped}') THEN
      RAISE EXCEPTION 'falta la policy RESTRICTIVE scope_% en %', t, t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '% no tiene RLS forzado', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      RAISE EXCEPTION '% perdió la policy tenant_isolation (la barrera es ADICIONAL, no la reemplaza)', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 1/6 · cinco policies de alcance + tenant_isolation + RLS forzado';
END $$;

-- 2. El rol de la API cumple RLS (sin BYPASSRLS ni superusuario): si lo ignorara, nada de esto protegería.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app' AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'kobrax_app ignora RLS (BYPASSRLS o superusuario)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_scoped' AND (rolbypassrls OR rolsuper OR rolcanlogin)) THEN
    RAISE EXCEPTION 'kobrax_scoped ignora RLS, es superusuario o puede iniciar sesión';
  END IF;
  IF NOT pg_has_role('kobrax_app', 'kobrax_scoped', 'MEMBER') THEN
    RAISE EXCEPTION 'kobrax_app no puede hacer SET ROLE kobrax_scoped';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants g WHERE g.grantee = 'kobrax_app' AND g.table_schema = 'public'
             AND NOT has_table_privilege('kobrax_scoped', format('%I.%I', g.table_schema, g.table_name), g.privilege_type)) THEN
    RAISE EXCEPTION 'a kobrax_scoped le faltan permisos de tabla que tiene kobrax_app (volver a correr rls/006)';
  END IF;
  IF pg_has_role('kobrax_app', 'kobrax_scoped', 'USAGE') THEN
    RAISE EXCEPTION 'kobrax_app HEREDA kobrax_scoped: las policies de alcance le aplicarían siempre (ALTER ROLE kobrax_app NOINHERIT)';
  END IF;
  RAISE NOTICE 'OK 2/6 · kobrax_app es NOBYPASSRLS; kobrax_scoped también, sin login, con los mismos permisos';
END $$;

-- 3. R-2: las funciones SECURITY DEFINER que suman sobre tablas protegidas (totales del cliente, episodios de mora) deben pertenecer a
--    un rol que ignora RLS; si no, sus agregados se recortarían al alcance de quien dispara el trigger y quedarían corruptos.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.proname || ' (dueño ' || r.rolname || ')', ', ') INTO bad
  FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.prosecdef AND p.proname IN ('portfolio_totals_recalc', 'credits_track_arrear_episode', 'scope_copy_credit_owner', 'credits_push_scope_owner', 'app_my_assigned_client_arr') AND NOT (r.rolsuper OR r.rolbypassrls);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'funciones SECURITY DEFINER cuyo dueño NO ignora RLS: %', bad;
  END IF;
  RAISE NOTICE 'OK 3/6 · las funciones SECURITY DEFINER de totales las posee un rol que ignora RLS';
END $$;

-- 4. Las copias de oficina / responsable (la barrera NO consulta `credits` por fila: lee estas columnas) coinciden con la verdad. Si una carga
--    masiva apagó los triggers (session_replication_role = replica), esto lo detecta; el arreglo es el backfill de la migración
--    `20261106000000_f14_f2b_scope_copies`.
DO $$
DECLARE n_pay bigint; n_ag bigint; n_cli bigint; trg int;
BEGIN
  SELECT count(*) INTO trg FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('payments_scope_copy', 'agenda_items_scope_copy', 'credits_scope_push', 'credits_totals_upd');
  IF trg <> 4 THEN RAISE EXCEPTION 'faltan triggers de las copias (hay % de 4)', trg; END IF;
  -- La copia vale lo que el crédito si está VIVO, y NULL si está dado de baja.
  SELECT count(*) INTO n_pay FROM payments p JOIN credits c ON c.id = p.credit_id
    WHERE p.credit_branch_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.branch_id END)
       OR p.credit_manager_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.assigned_manager_id END);
  SELECT count(*) INTO n_ag FROM agenda_items a JOIN credits c ON c.id = a.credit_id
    WHERE a.credit_branch_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.branch_id END)
       OR a.credit_manager_id IS DISTINCT FROM (CASE WHEN c.deleted_at IS NULL THEN c.assigned_manager_id END);
  SELECT count(*) INTO n_cli FROM clients cl
    LEFT JOIN (SELECT client_id, array_agg(DISTINCT assigned_manager_id ORDER BY assigned_manager_id) FILTER (WHERE assigned_manager_id IS NOT NULL) m,
                      array_agg(DISTINCT branch_id ORDER BY branch_id) FILTER (WHERE branch_id IS NOT NULL) b
               FROM credits WHERE deleted_at IS NULL GROUP BY client_id) s ON s.client_id = cl.id
    WHERE cl.scope_manager_ids IS DISTINCT FROM COALESCE(s.m, '{}') OR cl.scope_branch_ids IS DISTINCT FROM COALESCE(s.b, '{}');
  IF n_pay + n_ag + n_cli > 0 THEN
    RAISE EXCEPTION 'copias desalineadas: payments %, agenda_items %, clients % (correr el backfill de la migración 20261106000000)', n_pay, n_ag, n_cli;
  END IF;
  RAISE NOTICE 'OK 4/6 · las copias de oficina y responsable coinciden con los créditos';
END $$;

-- 5. JIT apagado para el rol de la API (con las policies instaladas el JIT se dispara sin necesidad: 40 ms → 1,3 s).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'kobrax_app' AND s.setconfig::text LIKE '%jit=off%') THEN
    RAISE EXCEPTION 'kobrax_app no tiene jit = off (ALTER ROLE kobrax_app SET jit = off; está en rls/006)';
  END IF;
  RAISE NOTICE 'OK 5/6 · jit apagado para kobrax_app';
END $$;

-- 6. Fail-closed: como kobrax_app, con `enforce` y SIN alcance, no se ve ni una fila de las cinco tablas (aunque haya tenant).
CREATE TEMP TABLE _verify_accounts AS SELECT id FROM accounts; -- se leen como superusuario: con RLS, kobrax_app no ve la tabla sin cuenta
GRANT SELECT ON _verify_accounts TO kobrax_app, kobrax_scoped;
SET ROLE kobrax_app;
BEGIN;
  SET LOCAL ROLE kobrax_scoped; -- el rol al que cambia la API con alcance restringido
  SELECT set_config('app.scope_mode', 'enforce', true), set_config('app.scope', '', true);
  DO $$
  DECLARE t text; n bigint; acc text; cuentas int := 0;
  BEGIN
    FOR acc IN SELECT id FROM _verify_accounts LOOP
      cuentas := cuentas + 1;
      PERFORM set_config('app.current_account_id', acc, true);
      FOREACH t IN ARRAY ARRAY['credits','clients','payments','agenda_items','route_plans'] LOOP
        EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
        IF n <> 0 THEN RAISE EXCEPTION 'sin alcance, % deja ver % filas de la cuenta %', t, n, acc; END IF;
      END LOOP;
    END LOOP;
    IF cuentas = 0 THEN RAISE EXCEPTION 'no hay cuentas que probar'; END IF;
    RAISE NOTICE 'OK 6/6 · sin alcance y en enforce no se ve nada (fail-closed), % cuentas', cuentas;
  END $$;
ROLLBACK;
RESET ROLE;
