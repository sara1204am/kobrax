-- Kobrax · Verificación de las versiones de autorización (F14 · F1). SOLO LEE; se puede correr en cualquier entorno, también en producción.
--
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 < packages/database/prisma/rls/verify_authz.sql
--   o todas juntas:  pnpm --filter @kobrax/database db:verify
--
-- Cada bloque imprime OK o aborta con la causa. La prueba con sesiones reales vive en las integraciones `authz-versions.it.ts` y `f7`/`f8`.

\set ON_ERROR_STOP on

-- 1. La versión de la membresía y la política global existen y son coherentes.
DO $$
DECLARE n_policy int; v_policy int; sin_version bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_accounts' AND column_name = 'authz_version' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'user_accounts.authz_version no existe o admite NULL';
  END IF;
  SELECT count(*), max(policy_version) INTO n_policy, v_policy FROM platform_settings;
  IF n_policy <> 1 THEN RAISE EXCEPTION 'platform_settings debe tener UNA sola fila y tiene %', n_policy; END IF;
  IF v_policy IS NULL OR v_policy < 1 THEN RAISE EXCEPTION 'policy_version inválida: %', v_policy; END IF;
  SELECT count(*) INTO sin_version FROM user_accounts WHERE authz_version < 1;
  IF sin_version > 0 THEN RAISE EXCEPTION '% membresías con authz_version < 1', sin_version; END IF;
  RAISE NOTICE 'OK 1/5 · authz_version (NOT NULL, ≥ 1) y platform_settings con una fila (policy_version = %)', v_policy;
END $$;

-- 2. La outbox de versiones: tabla con RLS forzado y sus tres funciones de servicio (SECURITY DEFINER, con search_path fijo).
DO $$
DECLARE f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'authz_version_outbox' AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION 'authz_version_outbox no tiene RLS forzado';
  END IF;
  FOREACH f IN ARRAY ARRAY['authz_outbox_pending', 'authz_outbox_mark', 'authz_membership_version'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = f AND p.prosecdef) THEN RAISE EXCEPTION 'la función % no existe o no es SECURITY DEFINER (correr rls/005)', f; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname = f AND p.prosecdef AND p.proconfig IS NULL) THEN RAISE EXCEPTION 'la función % no fija search_path', f; END IF;
  END LOOP;
  RAISE NOTICE 'OK 2/5 · authz_version_outbox con RLS forzado; las 3 funciones SECURITY DEFINER existen con search_path fijo';
END $$;

-- 3. Nada de la outbox lleva atascado: lo pendiente de publicar a Redis hace más de 10 minutos delata un reconciliador caído.
DO $$
DECLARE atascadas bigint;
BEGIN
  SELECT count(*) INTO atascadas FROM authz_version_outbox
    WHERE processed_at IS NULL AND created_at < now() - interval '10 minutes';
  IF atascadas > 0 THEN RAISE EXCEPTION '% versiones sin publicar a Redis hace más de 10 min (reconciliador caído: reiniciar la API reconcilia)', atascadas; END IF;
  RAISE NOTICE 'OK 3/5 · la outbox no tiene versiones atascadas';
END $$;

-- 4. El dispositivo de la sesión (de él sale el canal del token, F14 · F8): la columna existe y las sesiones vigentes lo tienen.
DO $$
DECLARE sin_dispositivo bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'device_type') THEN
    RAISE EXCEPTION 'user_sessions.device_type no existe';
  END IF;
  SELECT count(*) INTO sin_dispositivo FROM user_sessions WHERE is_active AND (device_type IS NULL OR device_type = '');
  IF sin_dispositivo > 0 THEN RAISE NOTICE 'AVISO · % sesiones vigentes sin dispositivo: usan el encabezado hasta que renueven (esperado en el primer despliegue)', sin_dispositivo; END IF;
  RAISE NOTICE 'OK 4/5 · user_sessions.device_type existe';
END $$;

-- 5. El creador del cliente (R-03) y los clientes que quedaron sin oficina de registro (informativo: no es un error, ver prisma/verify/f14-cliente-registro.sql).
DO $$
DECLARE sin_oficina bigint; vivos bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'created_by') THEN RAISE EXCEPTION 'clients.created_by no existe'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'registered_branch_id') THEN RAISE EXCEPTION 'clients.registered_branch_id no existe'; END IF;
  SELECT count(*) FILTER (WHERE registered_branch_id IS NULL), count(*) INTO sin_oficina, vivos FROM clients WHERE deleted_at IS NULL;
  RAISE NOTICE 'OK 5/5 · clients.created_by y registered_branch_id existen (% de % clientes vivos sin oficina de registro: los ven ALL/SUBTREE y su creador)', sin_oficina, vivos;
END $$;
