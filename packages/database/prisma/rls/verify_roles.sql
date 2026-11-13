-- Kobrax · Verificación de los roles por cuenta (F14 · F5). SOLO LEE; se puede correr en cualquier entorno.
--
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 < packages/database/prisma/rls/verify_roles.sql

\set ON_ERROR_STOP on

-- 1. RLS de las tablas por cuenta; permisos de la API y del rol de la barrera; las plantillas son legibles.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_roles', 'account_role_permissions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION '% no tiene RLS forzado', t; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN RAISE EXCEPTION '% sin policy tenant_isolation', t; END IF;
    IF NOT has_table_privilege('kobrax_app', t, 'SELECT, INSERT, UPDATE, DELETE') THEN RAISE EXCEPTION 'kobrax_app sin permisos sobre %', t; END IF;
    IF NOT has_table_privilege('kobrax_scoped', t, 'SELECT, INSERT, UPDATE, DELETE') THEN RAISE EXCEPTION 'kobrax_scoped sin permisos sobre % (volver a correr rls/006)', t; END IF;
  END LOOP;
  IF NOT has_table_privilege('kobrax_app', 'role_templates', 'SELECT') OR NOT has_table_privilege('kobrax_app', 'role_template_permissions', 'SELECT') THEN
    RAISE EXCEPTION 'kobrax_app no puede leer las plantillas';
  END IF;
  RAISE NOTICE 'OK 1/5 · account_roles y account_role_permissions con RLS forzado y permisos; plantillas legibles';
END $$;

-- 2. Toda cuenta viva tiene sus seis roles, y cada rol de cuenta tiene EXACTAMENTE los permisos de su plantilla (mientras no haya divergido).
DO $$
DECLARE n_templates int; sin_roles bigint; distintos bigint;
BEGIN
  SELECT count(*) INTO n_templates FROM role_templates;
  IF n_templates <> 6 THEN RAISE EXCEPTION 'se esperaban 6 plantillas de rol y hay %', n_templates; END IF;
  SELECT count(*) INTO sin_roles FROM accounts a
    WHERE a.deleted_at IS NULL AND (SELECT count(*) FROM account_roles ar WHERE ar.account_id = a.id AND ar.deleted_at IS NULL) < n_templates;
  IF sin_roles > 0 THEN RAISE EXCEPTION '% cuentas sin sus roles (correr create_account_roles)', sin_roles; END IF;
  SELECT count(*) INTO distintos FROM account_roles ar
    WHERE ar.diverged_at IS NULL AND ar.template_key IS NOT NULL AND (
      EXISTS (SELECT 1 FROM role_template_permissions t WHERE t.template_key = ar.template_key AND NOT EXISTS (SELECT 1 FROM account_role_permissions x WHERE x.account_role_id = ar.id AND x.permission_id = t.permission_id))
      OR EXISTS (SELECT 1 FROM account_role_permissions x WHERE x.account_role_id = ar.id AND x.source = 'TEMPLATE' AND NOT EXISTS (SELECT 1 FROM role_template_permissions t WHERE t.template_key = ar.template_key AND t.permission_id = x.permission_id)));
  IF distintos > 0 THEN RAISE EXCEPTION '% roles de cuenta sin divergir cuyos permisos no coinciden con su plantilla', distintos; END IF;
  RAISE NOTICE 'OK 2/5 · % plantillas; toda cuenta tiene sus roles; los roles sin divergir coinciden con su plantilla', n_templates;
END $$;

-- 3. Las membresías: cada una con rol global de plantilla tiene su rol de cuenta, y es el de SU cuenta y el MISMO nombre.
DO $$
DECLARE sin_rol bigint; cruzadas bigint; distinto_nombre bigint;
BEGIN
  SELECT count(*) INTO sin_rol FROM user_accounts ua JOIN roles r ON r.id = ua.role_id
    WHERE r.name <> 'SUPER_ADMIN' AND ua.account_role_id IS NULL;
  SELECT count(*) INTO cruzadas FROM user_accounts ua JOIN account_roles ar ON ar.id = ua.account_role_id WHERE ar.account_id <> ua.account_id;
  SELECT count(*) INTO distinto_nombre FROM user_accounts ua JOIN account_roles ar ON ar.id = ua.account_role_id JOIN roles r ON r.id = ua.role_id WHERE ar.key <> r.name;
  IF sin_rol > 0 THEN RAISE EXCEPTION '% membresías sin rol de cuenta', sin_rol; END IF;
  IF cruzadas > 0 THEN RAISE EXCEPTION '% membresías apuntan al rol de OTRA cuenta', cruzadas; END IF;
  IF distinto_nombre > 0 THEN RAISE EXCEPTION '% membresías cuyo rol de cuenta no coincide con su rol global', distinto_nombre; END IF;
  RAISE NOTICE 'OK 3/5 · toda membresía de rol de empresa tiene el rol de su cuenta, con el mismo nombre que el global';
END $$;

-- 4. A lo sumo un data:scope:* por rol (plantilla y rol de cuenta).
DO $$
DECLARE malos bigint;
BEGIN
  SELECT count(*) INTO malos FROM (
    SELECT x.account_role_id FROM account_role_permissions x JOIN permissions p ON p.id = x.permission_id WHERE p.code LIKE 'data:scope:%' GROUP BY x.account_role_id HAVING count(*) > 1
    UNION ALL
    SELECT x.template_key FROM role_template_permissions x JOIN permissions p ON p.id = x.permission_id WHERE p.code LIKE 'data:scope:%' GROUP BY x.template_key HAVING count(*) > 1) q;
  IF malos > 0 THEN RAISE EXCEPTION '% roles con más de un permiso de alcance', malos; END IF;
  RAISE NOTICE 'OK 4/5 · a lo sumo un data:scope:* por rol';
END $$;

-- 5. Las funciones SECURITY DEFINER las posee un rol que ignora RLS (escriben en tablas protegidas aunque quien las dispara tenga alcance chico).
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.proname || ' (dueño ' || r.rolname || ')', ', ') INTO bad
  FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.prosecdef AND p.proname IN ('create_account_roles', 'accounts_create_roles', 'user_accounts_sync_account_role') AND NOT (r.rolsuper OR r.rolbypassrls);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'funciones SECURITY DEFINER cuyo dueño NO ignora RLS: %', bad; END IF;
  RAISE NOTICE 'OK 5/5 · las funciones de roles por cuenta las posee un rol que ignora RLS';
END $$;
