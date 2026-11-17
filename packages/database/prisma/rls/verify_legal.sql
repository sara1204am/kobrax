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
  RAISE NOTICE 'OK 1/3 · las 3 tablas legales: kobrax_app y kobrax_scoped solo pueden leer e insertar';
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
  RAISE NOTICE 'OK 2/3 · triggers de inmutabilidad presentes en las 3 tablas';
END $$;

-- 3. Cada aceptación apunta a una versión existente y su hash copiado coincide con el de la versión (la prueba es consistente).
DO $$
DECLARE malas bigint;
BEGIN
  SELECT count(*) INTO malas FROM user_legal_acceptances a
    JOIN legal_document_versions v ON v.id = a.document_version_id WHERE a.content_sha256 <> v.content_sha256;
  IF malas > 0 THEN RAISE EXCEPTION '% aceptaciones cuyo hash no coincide con el de su versión', malas; END IF;
  RAISE NOTICE 'OK 3/3 · todas las aceptaciones guardan el hash exacto de la versión aceptada';
END $$;
