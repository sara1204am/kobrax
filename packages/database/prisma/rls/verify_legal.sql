-- Kobrax · Verificación de la evidencia legal (privacidad y consentimiento). SOLO LEE; se puede correr en cualquier entorno.
--
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 < packages/database/prisma/rls/verify_legal.sql

\set ON_ERROR_STOP on

-- 1. Las tres tablas existen y NINGÚN rol de la aplicación puede modificar, borrar ni vaciar: solo leer e insertar.
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['legal_document_versions', 'user_legal_acceptances', 'consent_records'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE EXCEPTION 'falta la tabla %', t; END IF;
    FOREACH r IN ARRAY ARRAY['kobrax_app', 'kobrax_scoped'] LOOP
      IF NOT has_table_privilege(r, t, 'SELECT') OR NOT has_table_privilege(r, t, 'INSERT') THEN
        RAISE EXCEPTION '% no puede leer/insertar en % (correr db:rls)', r, t;
      END IF;
      IF has_table_privilege(r, t, 'UPDATE') OR has_table_privilege(r, t, 'DELETE') OR has_table_privilege(r, t, 'TRUNCATE') THEN
        RAISE EXCEPTION '% PUEDE modificar, borrar o vaciar % (la evidencia es solo INSERT; correr db:rls)', r, t;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'OK 1/5 · las 3 tablas legales: kobrax_app y kobrax_scoped solo pueden leer e insertar';
END $$;

-- 2. El trigger de inmutabilidad (UPDATE/DELETE por fila y TRUNCATE por sentencia) está en las tres tablas.
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'legal_forbid_mutation') THEN RAISE EXCEPTION 'falta la función legal_forbid_mutation'; END IF;
  FOREACH t IN ARRAY ARRAY['legal_document_versions', 'user_legal_acceptances', 'consent_records'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND tgname = t || '_immutable' AND NOT tgisinternal) THEN
      RAISE EXCEPTION '% sin el trigger de inmutabilidad (UPDATE/DELETE)', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND tgname = t || '_no_truncate' AND NOT tgisinternal) THEN
      RAISE EXCEPTION '% sin el trigger que impide TRUNCATE', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 2/5 · triggers de inmutabilidad presentes en las 3 tablas';
END $$;

-- 3. Cada aceptación apunta a una versión existente y su hash copiado coincide con el de la versión (la prueba es consistente).
DO $$
DECLARE malas bigint;
BEGIN
  SELECT count(*) INTO malas FROM user_legal_acceptances a
    JOIN legal_document_versions v ON v.id = a.document_version_id WHERE a.content_sha256 <> v.content_sha256;
  IF malas > 0 THEN RAISE EXCEPTION '% aceptaciones cuyo hash no coincide con el de su versión', malas; END IF;
  RAISE NOTICE 'OK 3/5 · todas las aceptaciones guardan el hash exacto de la versión aceptada';
END $$;

-- 4. Solicitudes de derechos: los eventos son solo INSERT (permisos + triggers) y las solicitudes no se pueden borrar ni vaciar.
DO $$
DECLARE r text;
BEGIN
  IF to_regclass('public.privacy_requests') IS NULL OR to_regclass('public.privacy_request_events') IS NULL THEN RAISE EXCEPTION 'faltan las tablas de solicitudes de derechos'; END IF;
  FOREACH r IN ARRAY ARRAY['kobrax_app', 'kobrax_scoped'] LOOP
    IF has_table_privilege(r, 'privacy_request_events', 'UPDATE') OR has_table_privilege(r, 'privacy_request_events', 'DELETE') OR has_table_privilege(r, 'privacy_request_events', 'TRUNCATE') THEN
      RAISE EXCEPTION '% PUEDE modificar o borrar los eventos de solicitudes (solo INSERT; correr db:rls)', r;
    END IF;
    IF has_table_privilege(r, 'privacy_requests', 'DELETE') OR has_table_privilege(r, 'privacy_requests', 'TRUNCATE') THEN
      RAISE EXCEPTION '% PUEDE borrar solicitudes (nunca se borran; correr db:rls)', r;
    END IF;
    IF NOT has_table_privilege(r, 'privacy_requests', 'SELECT, INSERT, UPDATE') OR NOT has_table_privilege(r, 'privacy_request_events', 'SELECT, INSERT') THEN
      RAISE EXCEPTION '% sin permisos de lectura/escritura sobre las solicitudes (correr db:rls)', r;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.privacy_request_events'::regclass AND tgname = 'privacy_request_events_immutable' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.privacy_request_events'::regclass AND tgname = 'privacy_request_events_no_truncate' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'privacy_request_events sin sus triggers de inmutabilidad';
  END IF;
  RAISE NOTICE 'OK 4/5 · eventos de solicitudes solo INSERT; las solicitudes no se pueden borrar';
END $$;

-- 5. privacy_requests tiene RLS forzado y su policy: una cuenta no ve las solicitudes de otra.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'privacy_requests' AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'privacy_requests sin RLS forzado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'privacy_requests' AND policyname = 'privacy_requests_access') THEN RAISE EXCEPTION 'privacy_requests sin su policy de acceso'; END IF;
  RAISE NOTICE 'OK 5/5 · privacy_requests con RLS forzado y su policy';
END $$;
