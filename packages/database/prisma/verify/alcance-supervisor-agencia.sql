-- Verificación de la migración 20261004010000_alcance_supervisor_agencia (F4/08 · fase 2B, D8).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/alcance-supervisor-agencia.sql
--
-- Sólo LEE. Termina con un error si el alcance de los roles no es el de la decisión D8:
--   SUPERVISOR = data:scope:branch (y NO data:scope:all) · MANAGER/ACCOUNT_ADMIN/SUPER_ADMIN = all ·
--   COLLECTOR = ninguno · el permiso existe una sola vez y con alcance BRANCH.

SELECT r.name AS rol,
       bool_or(p.code = 'data:scope:all')    AS scope_all,
       bool_or(p.code = 'data:scope:branch') AS scope_branch
FROM roles r
LEFT JOIN role_permissions rp ON rp.role_id = r.id
LEFT JOIN permissions p ON p.id = rp.permission_id AND p.code IN ('data:scope:all', 'data:scope:branch')
GROUP BY r.name ORDER BY r.name;

DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n FROM permissions WHERE code = 'data:scope:branch' AND scope::text = 'BRANCH';
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO: data:scope:branch debe existir una vez con alcance BRANCH (hay %)', n; END IF;

  SELECT count(*) INTO n FROM roles r WHERE r.name = 'SUPERVISOR'
    AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'data:scope:all');
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: el SUPERVISOR sigue con data:scope:all'; END IF;

  SELECT count(*) INTO n FROM roles r WHERE r.name = 'SUPERVISOR'
    AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'data:scope:branch');
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: el SUPERVISOR no tiene data:scope:branch'; END IF;

  SELECT count(*) INTO n FROM roles r WHERE r.name IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN', 'MANAGER')
    AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'data:scope:all');
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % rol(es) de gerencia/administración sin data:scope:all', n; END IF;

  SELECT count(*) INTO n FROM roles r WHERE r.name = 'COLLECTOR'
    AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code IN ('data:scope:all', 'data:scope:branch'));
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: el COLLECTOR tiene un alcance mayor al propio'; END IF;

  RAISE NOTICE 'OK · alcance-supervisor-agencia verificada';
END $$;
