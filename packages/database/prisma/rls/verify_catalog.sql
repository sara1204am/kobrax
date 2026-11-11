-- Kobrax · Verificación del catálogo de permisos y los roles de plantilla (F14 · F7). SOLO LEE; se puede correr en cualquier entorno, también en producción.
--
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 < packages/database/prisma/rls/verify_catalog.sql
--   o todas juntas:  pnpm --filter @kobrax/database db:verify
--
-- La fuente de los metadatos es `PERMISSION_META` (packages/shared). Acá se comprueba lo que depende de los DATOS del entorno: que la base los tenga cargados
-- y que las plantillas y los roles de las cuentas sean coherentes con ellos. (Una prueba de `shared` exige además que la migración coincida con el código.)

\set ON_ERROR_STOP on

-- 1. Todo permiso activo tiene riesgo; y los reservados son EXACTAMENTE el núcleo del administrador (los 4 que existan).
DO $$
DECLARE sin_riesgo bigint; reservados text; esperados text := 'account:write,office:write,role:write,user:write';
BEGIN
  SELECT count(*) INTO sin_riesgo FROM permissions WHERE active AND risk IS NULL;
  IF sin_riesgo > 0 THEN RAISE EXCEPTION '% permisos sin riesgo', sin_riesgo; END IF;
  SELECT string_agg(code, ',' ORDER BY code) INTO reservados FROM permissions WHERE reserved = 'ADMIN_CORE';
  IF reservados IS DISTINCT FROM esperados THEN
    RAISE EXCEPTION 'los permisos reservados son [%] y deberían ser [%] (correr la migración f14_f7_permission_catalog_meta o `db:seed`)', reservados, esperados;
  END IF;
  IF EXISTS (SELECT 1 FROM permissions WHERE reserved = 'PLATFORM') THEN RAISE EXCEPTION 'hay permisos de plataforma dentro del catálogo de empresa'; END IF;
  RAISE NOTICE 'OK 1/7 · todo permiso tiene riesgo; los reservados son [%]', reservados;
END $$;

-- 2. Las dependencias (`requires`): son una lista de códigos que existen y nadie depende de sí mismo.
DO $$
DECLARE mal text;
BEGIN
  IF EXISTS (SELECT 1 FROM permissions WHERE jsonb_typeof(requires) <> 'array') THEN RAISE EXCEPTION 'hay permisos cuyo requires no es una lista'; END IF;
  SELECT string_agg(p.code || ' → ' || r, '; ') INTO mal
    FROM permissions p, jsonb_array_elements_text(p.requires) r
    WHERE (r = p.code OR NOT EXISTS (SELECT 1 FROM permissions q WHERE q.code = r));
  IF mal IS NOT NULL THEN RAISE EXCEPTION 'dependencias inválidas: %', mal; END IF;
  RAISE NOTICE 'OK 2/7 · % permisos con dependencias, todas válidas', (SELECT count(*) FROM permissions WHERE jsonb_array_length(requires) > 0);
END $$;

-- 3. Las plantillas están CERRADAS bajo sus dependencias (si no, las copias de las cuentas no se podrían guardar) y cada una tiene a lo sumo un alcance de datos.
DO $$
DECLARE mal text; varios text;
BEGIN
  SELECT string_agg(t.template_key || ': ' || p.code || ' pide ' || r, '; ') INTO mal
    FROM role_template_permissions t
    JOIN permissions p ON p.id = t.permission_id, jsonb_array_elements_text(p.requires) r
    WHERE NOT EXISTS (SELECT 1 FROM role_template_permissions t2 JOIN permissions p2 ON p2.id = t2.permission_id WHERE t2.template_key = t.template_key AND p2.code = r);
  IF mal IS NOT NULL THEN RAISE EXCEPTION 'plantillas que violan sus dependencias: %', mal; END IF;
  SELECT string_agg(template_key, ', ') INTO varios FROM (
    SELECT t.template_key FROM role_template_permissions t JOIN permissions p ON p.id = t.permission_id
    WHERE p.code LIKE 'data:scope:%' GROUP BY t.template_key HAVING count(*) > 1) x;
  IF varios IS NOT NULL THEN RAISE EXCEPTION 'plantillas con más de un alcance de datos: %', varios; END IF;
  RAISE NOTICE 'OK 3/7 · las plantillas cumplen sus dependencias y tienen a lo sumo un alcance de datos';
END $$;

-- 4. Roles de las cuentas: a lo sumo un alcance de datos, ningún permiso reservado fuera de ACCOUNT_ADMIN y ningún permiso de plataforma.
DO $$
DECLARE varios bigint; reservados bigint;
BEGIN
  SELECT count(*) INTO varios FROM (
    SELECT arp.account_role_id FROM account_role_permissions arp JOIN permissions p ON p.id = arp.permission_id
    WHERE p.code LIKE 'data:scope:%' GROUP BY arp.account_role_id HAVING count(*) > 1) x;
  IF varios > 0 THEN RAISE EXCEPTION '% roles de cuenta con más de un alcance de datos', varios; END IF;
  SELECT count(*) INTO reservados FROM account_role_permissions arp
    JOIN permissions p ON p.id = arp.permission_id JOIN account_roles ar ON ar.id = arp.account_role_id
    WHERE p.reserved = 'ADMIN_CORE' AND ar.key <> 'ACCOUNT_ADMIN';
  IF reservados > 0 THEN RAISE EXCEPTION '% permisos reservados concedidos a roles que no son ACCOUNT_ADMIN', reservados; END IF;
  IF EXISTS (SELECT 1 FROM account_role_permissions arp JOIN permissions p ON p.id = arp.permission_id WHERE p.code LIKE 'platform:%') THEN
    RAISE EXCEPTION 'un rol de cuenta tiene un permiso de plataforma';
  END IF;
  RAISE NOTICE 'OK 4/7 · roles de cuenta: a lo sumo un alcance, sin reservados fuera del administrador, sin permisos de plataforma';
END $$;

-- 5. El administrador de cada cuenta conserva el núcleo (no se puede quedar sin poder editar roles ni personas).
DO $$
DECLARE sin_nucleo bigint;
BEGIN
  SELECT count(*) INTO sin_nucleo FROM account_roles ar
    WHERE ar.key = 'ACCOUNT_ADMIN' AND ar.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM permissions p WHERE p.reserved = 'ADMIN_CORE'
        AND NOT EXISTS (SELECT 1 FROM account_role_permissions arp WHERE arp.account_role_id = ar.id AND arp.permission_id = p.id));
  IF sin_nucleo > 0 THEN RAISE EXCEPTION '% roles de administrador sin alguno de los permisos reservados', sin_nucleo; END IF;
  RAISE NOTICE 'OK 5/7 · todo administrador de cuenta conserva el núcleo reservado';
END $$;

-- 6. N-02 (F14 · F5): la columna `permissions.scope` significa algo. Antes todas las filas valían GLOBAL por defecto; ahora ningún permiso activo lo es.
DO $$
DECLARE global_ bigint;
BEGIN
  SELECT count(*) INTO global_ FROM permissions WHERE active AND scope::text = 'GLOBAL';
  IF global_ > 0 THEN RAISE EXCEPTION '% permisos activos con scope GLOBAL (el alcance de cada permiso lo fija la migración de F5 o `db:seed`)', global_; END IF;
  RAISE NOTICE 'OK 6/7 · ningún permiso activo con scope GLOBAL';
END $$;

-- 7. Roles de cuenta que incumplen una dependencia (informativo: el editor no deja AGRAVAR un caso así, pero no lo arregla solo).
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT DISTINCT arp.account_role_id FROM account_role_permissions arp
    JOIN permissions p ON p.id = arp.permission_id, jsonb_array_elements_text(p.requires) r
    WHERE NOT EXISTS (SELECT 1 FROM account_role_permissions a2 JOIN permissions p2 ON p2.id = a2.permission_id WHERE a2.account_role_id = arp.account_role_id AND p2.code = r)) x;
  IF n > 0 THEN RAISE NOTICE 'AVISO · % roles de cuenta incumplen alguna dependencia (permitido: viene de antes del editor)', n; END IF;
  RAISE NOTICE 'OK 7/7 · roles de cuenta con dependencias incumplidas: %', n;
END $$;
