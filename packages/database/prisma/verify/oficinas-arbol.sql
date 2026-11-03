-- Verificación de la migración 20261102000000_oficinas_arbol (F13 · P1 Datos).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/oficinas-arbol.sql
--
-- Sólo LEE. Termina con un error si el árbol de oficinas no es coherente. Informa (NOTICE) lo que NO es un error pero
-- debe revisarse: los créditos sin oficina (excepciones del backfill, D-3) y los pagos con oficina huérfana.

DO $$
DECLARE
  n bigint;
BEGIN
  -- 1 · Toda cuenta tiene tipos y exactamente UNA raíz viva.
  SELECT count(*) INTO n FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.account_id = a.id AND b.is_root AND b.deleted_at IS NULL);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % cuenta(s) sin oficina raíz', n; END IF;
  SELECT count(*) INTO n FROM (SELECT account_id FROM branches WHERE is_root AND deleted_at IS NULL GROUP BY account_id HAVING count(*) > 1) x;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % cuenta(s) con más de una raíz viva', n; END IF;
  SELECT count(*) INTO n FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM branch_types t WHERE t.account_id = a.id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % cuenta(s) sin tipos de oficina', n; END IF;

  -- 2 · Forma del árbol: la raíz no tiene padre y todo lo demás sí; el padre es de la misma cuenta.
  SELECT count(*) INTO n FROM branches WHERE (is_root AND parent_id IS NOT NULL) OR (NOT is_root AND parent_id IS NULL);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % oficina(s) con padre inconsistente con is_root', n; END IF;
  SELECT count(*) INTO n FROM branches b JOIN branches p ON p.id = b.parent_id WHERE p.account_id <> b.account_id;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % oficina(s) con padre de OTRA cuenta (fuga entre tenants)', n; END IF;
  SELECT count(*) INTO n FROM branches b JOIN branch_types t ON t.id = b.type_id WHERE t.account_id <> b.account_id;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % oficina(s) con tipo de OTRA cuenta', n; END IF;

  -- 3 · Ruta materializada: path = path(padre) || id || '/', depth = depth(padre) + 1. Sin ciclos (la ruta lo impide).
  SELECT count(*) INTO n FROM branches WHERE is_root AND (path <> '/' || id || '/' OR depth <> 0);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % raíz(ces) con path/depth incorrecto', n; END IF;
  SELECT count(*) INTO n FROM branches b JOIN branches p ON p.id = b.parent_id WHERE b.path <> p.path || b.id || '/' OR b.depth <> p.depth + 1;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % oficina(s) cuyo path/depth no sigue al de su padre', n; END IF;

  -- 4 · Asignaciones: de la misma cuenta, una vigente por persona y cuenta (restricción temporal), sin rol (ADR-0002).
  SELECT count(*) INTO n FROM user_branch_assignments a JOIN branches b ON b.id = a.branch_id WHERE b.account_id <> a.account_id;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % asignación(es) a una oficina de OTRA cuenta', n; END IF;
  SELECT count(*) INTO n FROM user_branch_assignments WHERE role_id IS NOT NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % asignación(es) con role_id (en F13 debe ser NULL)', n; END IF;
  -- Espejo: quien tiene user_accounts.branch_id tiene su asignación vigente en esa oficina.
  SELECT count(*) INTO n FROM user_accounts ua WHERE ua.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM user_branch_assignments a WHERE a.user_id = ua.user_id AND a.account_id = ua.account_id AND a.branch_id = ua.branch_id AND a.revoked_at IS NULL);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % usuario(s) con user_accounts.branch_id sin su asignación vigente', n; END IF;

  -- 5 · Créditos: la oficina de un crédito es de su misma cuenta.
  SELECT count(*) INTO n FROM credits c JOIN branches b ON b.id = c.branch_id WHERE b.account_id <> c.account_id;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % crédito(s) con oficina de OTRA cuenta (fuga entre tenants)', n; END IF;

  -- 6 · Pagos: la oficina histórica es de su misma cuenta (los huérfanos se INFORMAN abajo, no se reescriben).
  SELECT count(*) INTO n FROM payments p JOIN branches b ON b.id = p.branch_id WHERE b.account_id <> p.account_id;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % pago(s) con oficina de OTRA cuenta', n; END IF;

  RAISE NOTICE 'OK · oficinas-arbol verificada';
END $$;

-- Informes (no fallan): lo que el administrador debe revisar antes de activar NOT NULL en credits.branch_id (A-1).
SELECT a.business_name AS cuenta, count(*) AS creditos_sin_oficina
FROM credits c JOIN accounts a ON a.id = c.account_id
WHERE c.branch_id IS NULL AND c.deleted_at IS NULL
GROUP BY a.business_name ORDER BY 2 DESC;

SELECT count(*) AS pagos_con_oficina_huerfana
FROM payments p WHERE p.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p.branch_id);
