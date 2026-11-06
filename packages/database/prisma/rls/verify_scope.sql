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
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'scope_' || t AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT') THEN
      RAISE EXCEPTION 'falta la policy RESTRICTIVE scope_% en %', t, t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '% no tiene RLS forzado', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      RAISE EXCEPTION '% perdió la policy tenant_isolation (la barrera es ADICIONAL, no la reemplaza)', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 1/4 · cinco policies de alcance + tenant_isolation + RLS forzado';
END $$;

-- 2. El rol de la API cumple RLS (sin BYPASSRLS ni superusuario): si lo ignorara, nada de esto protegería.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app' AND (rolbypassrls OR rolsuper)) THEN
    RAISE EXCEPTION 'kobrax_app ignora RLS (BYPASSRLS o superusuario)';
  END IF;
  RAISE NOTICE 'OK 2/4 · kobrax_app es NOBYPASSRLS';
END $$;

-- 3. R-2: las funciones SECURITY DEFINER que suman sobre tablas protegidas (totales del cliente, episodios de mora) deben pertenecer a
--    un rol que ignora RLS; si no, sus agregados se recortarían al alcance de quien dispara el trigger y quedarían corruptos.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.proname || ' (dueño ' || r.rolname || ')', ', ') INTO bad
  FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.prosecdef AND p.proname IN ('portfolio_totals_recalc', 'credits_track_arrear_episode') AND NOT (r.rolsuper OR r.rolbypassrls);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'funciones SECURITY DEFINER cuyo dueño NO ignora RLS: %', bad;
  END IF;
  RAISE NOTICE 'OK 3/4 · las funciones SECURITY DEFINER de totales las posee un rol que ignora RLS';
END $$;

-- 4. Fail-closed: como kobrax_app, con `enforce` y SIN alcance, no se ve ni una fila de las cinco tablas (aunque haya tenant).
CREATE TEMP TABLE _verify_accounts AS SELECT id FROM accounts; -- se leen como superusuario: con RLS, kobrax_app no ve la tabla sin cuenta
GRANT SELECT ON _verify_accounts TO kobrax_app;
SET ROLE kobrax_app;
BEGIN;
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
    RAISE NOTICE 'OK 4/4 · sin alcance y en enforce no se ve nada (fail-closed), % cuentas', cuentas;
  END $$;
ROLLBACK;
RESET ROLE;
