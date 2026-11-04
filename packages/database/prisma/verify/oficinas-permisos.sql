-- Verificación de la migración 20261102010000_permisos_oficinas_alcance_subarbol (F13 · P2, R12/R13).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/oficinas-permisos.sql
--
-- Sólo LEE. Falla si los permisos de oficinas o el alcance del gerente regional no son los decididos.

DO $$
DECLARE
  n bigint;
BEGIN
  -- Los tres permisos existen una sola vez.
  SELECT count(*) INTO n FROM permissions WHERE code IN ('office:read', 'office:write', 'data:scope:subtree');
  IF n <> 3 THEN RAISE EXCEPTION 'FALLO: faltan permisos de oficinas/subárbol (hay % de 3)', n; END IF;

  -- D-7: el supervisor también lee oficinas (acotado por el servidor a las suyas).
  SELECT count(*) INTO n FROM roles r WHERE r.name = 'SUPERVISOR' AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id AND p.code = 'office:read' WHERE rp.role_id = r.id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: el SUPERVISOR no tiene office:read'; END IF;

  -- office:read lo tiene quien tiene user:read; office:write quien tiene account:write (equivalencia con lo que había).
  SELECT count(*) INTO n FROM role_permissions rp JOIN permissions pu ON pu.id = rp.permission_id AND pu.code = 'user:read'
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions r2 JOIN permissions po ON po.id = r2.permission_id AND po.code = 'office:read' WHERE r2.role_id = rp.role_id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % rol(es) con user:read sin office:read', n; END IF;
  SELECT count(*) INTO n FROM role_permissions rp JOIN permissions pa ON pa.id = rp.permission_id AND pa.code = 'account:write'
    WHERE NOT EXISTS (SELECT 1 FROM role_permissions r2 JOIN permissions po ON po.id = r2.permission_id AND po.code = 'office:write' WHERE r2.role_id = rp.role_id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % rol(es) con account:write sin office:write', n; END IF;

  -- MANAGER: subárbol y NO total. SUPERVISOR sigue con data:scope:branch.
  SELECT count(*) INTO n FROM roles r WHERE r.name = 'MANAGER'
    AND (EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'data:scope:all')
      OR NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'data:scope:subtree'));
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: el MANAGER debe tener data:scope:subtree y NO data:scope:all'; END IF;
  SELECT count(*) INTO n FROM roles r WHERE r.name = 'SUPERVISOR'
    AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND p.code = 'data:scope:branch');
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: el SUPERVISOR perdió data:scope:branch'; END IF;

  -- 🔴 Equivalencia: todo MANAGER activo tiene una asignación vigente a la RAÍZ de su cuenta (si no, perdió vista).
  SELECT count(*) INTO n FROM user_accounts ua JOIN roles r ON r.id = ua.role_id AND r.name = 'MANAGER'
    WHERE ua.is_active AND NOT EXISTS (
      SELECT 1 FROM user_branch_assignments a JOIN branches b ON b.id = a.branch_id
      WHERE a.user_id = ua.user_id AND a.account_id = ua.account_id AND a.revoked_at IS NULL AND b.is_root);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % MANAGER(s) sin asignación a la raíz de su cuenta (perderían vista)', n; END IF;

  RAISE NOTICE 'OK · oficinas-permisos verificada';
END $$;
