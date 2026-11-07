-- Kobrax · Verificación del registro de archivos (F14 · F4). SOLO LEE; se puede correr en cualquier entorno.
--
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 < packages/database/prisma/rls/verify_files.sql

\set ON_ERROR_STOP on

-- 1. Las dos tablas tienen RLS forzado y su policy de empresa; kobrax_app y kobrax_scoped pueden usarlas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['files', 'file_owners'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '% no tiene RLS forzado', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      RAISE EXCEPTION '% no tiene la policy tenant_isolation', t;
    END IF;
    IF NOT has_table_privilege('kobrax_app', t, 'SELECT, INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 'kobrax_app no tiene permisos sobre %', t;
    END IF;
    IF NOT has_table_privilege('kobrax_scoped', t, 'SELECT, INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 'kobrax_scoped no tiene permisos sobre % (volver a correr rls/006)', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'OK 1/3 · files y file_owners: RLS forzado, policy de empresa y permisos';
END $$;

-- 2. Toda referencia a un archivo (las URL de las demás tablas) tiene su dueño registrado.
DO $$
DECLARE falta bigint;
BEGIN
  WITH refs AS (
    SELECT account_id, substring(file_url from '[0-9a-f]{64}\.[a-z]{3,4}$') sk, 'CLIENT_ATTACHMENT' ent, id oid FROM client_attachments WHERE file_url IS NOT NULL
    UNION ALL SELECT l.account_id, substring(u from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'CLIENT_LOCATION', l.id
      FROM client_locations l, jsonb_array_elements_text(CASE WHEN jsonb_typeof(l.photo_urls) = 'array' THEN l.photo_urls ELSE '[]'::jsonb END) u
    UNION ALL SELECT r.account_id, substring(u from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'CLIENT_RELATION', r.id
      FROM client_relations r, jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.photo_urls) = 'array' THEN r.photo_urls ELSE '[]'::jsonb END) u
    UNION ALL SELECT c.account_id, substring(u from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'COLLATERAL', c.id
      FROM collaterals c, jsonb_array_elements_text(CASE WHEN jsonb_typeof(c.photo_urls) = 'array' THEN c.photo_urls ELSE '[]'::jsonb END) u
    UNION ALL SELECT account_id, substring(receipt_url from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'PAYMENT_RECEIPT', id FROM payments WHERE receipt_url IS NOT NULL
    UNION ALL SELECT account_id, substring(file_url from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'FIELD_EVIDENCE', id FROM field_evidences WHERE file_url IS NOT NULL
    UNION ALL SELECT id, substring(logo_url from '[0-9a-f]{64}\.[a-z]{3,4}$'), 'ACCOUNT_LOGO', id FROM accounts WHERE logo_url IS NOT NULL
    UNION ALL SELECT account_id, file_key, 'IMPORT_RUN', id FROM client_import_runs WHERE file_key IS NOT NULL
  )
  SELECT count(*) INTO falta FROM refs r
  WHERE r.sk IS NOT NULL AND r.account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM files f JOIN file_owners o ON o.file_id = f.id
    WHERE f.account_id = r.account_id AND f.storage_key = r.sk AND o.owner_entity::text = r.ent AND o.owner_id = r.oid);
  IF falta > 0 THEN
    RAISE EXCEPTION '% referencias de archivo sin dueño registrado (correr el relleno de la migración 20261106020000)', falta;
  END IF;
  RAISE NOTICE 'OK 2/3 · toda referencia de archivo (adjuntos, fotos, comprobantes, evidencias, logo, importaciones) tiene su dueño';
END $$;

-- 3. Consistencia: un archivo ATTACHED tiene al menos un dueño; un dueño no apunta a un archivo de otra cuenta.
DO $$
DECLARE sin_dueno bigint; cruzados bigint;
BEGIN
  SELECT count(*) INTO sin_dueno FROM files f WHERE f.status = 'ATTACHED' AND f.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM file_owners o WHERE o.file_id = f.id);
  SELECT count(*) INTO cruzados FROM file_owners o JOIN files f ON f.id = o.file_id WHERE o.account_id <> f.account_id;
  IF sin_dueno > 0 THEN RAISE EXCEPTION '% archivos ATTACHED sin ningún dueño', sin_dueno; END IF;
  IF cruzados > 0 THEN RAISE EXCEPTION '% dueños que apuntan a un archivo de otra cuenta', cruzados; END IF;
  RAISE NOTICE 'OK 3/3 · archivos ATTACHED con dueño, sin cruces entre cuentas';
END $$;
