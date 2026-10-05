-- Verificación de la migración 20261005000000_eliminar_caso (F4/08 · fase 6).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/sin-caso-contraccion.sql
--   (docker: docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 -f - < prisma/verify/sin-caso-contraccion.sql)
--
-- Sólo LEE. Vale tanto para una base recreada desde cero como para una actualizada con datos viejos:
-- comprueba que el caso desapareció y que lo que lo reemplazó quedó coherente.

DO $$
DECLARE
  n bigint;
  r record;
BEGIN
  -- 1 · tablas, columnas, enums y permisos del caso: ninguno
  IF to_regclass('public.collection_cases') IS NOT NULL OR to_regclass('public.case_activities') IS NOT NULL THEN
    RAISE EXCEPTION 'FALLO: siguen las tablas del caso';
  END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'case_id';
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % columnas case_id', n; END IF;
  SELECT count(*) INTO n FROM pg_type WHERE typname IN ('CaseStatus', 'CasePriority', 'CaseActivityType', 'NotificationType_new', 'CreditStatus_new');
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % enums del caso o temporales siguen existiendo', n; END IF;
  SELECT count(*) INTO n FROM permissions WHERE code LIKE 'case:%';
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % permisos case:*', n; END IF;

  -- 2 · los valores quitados de los enums
  SELECT count(*) INTO n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE (t.typname = 'NotificationType' AND e.enumlabel IN ('CASE_ASSIGNED', 'CASE_UPDATED'))
      OR (t.typname = 'CreditStatus' AND e.enumlabel = 'WRITTEN_OFF');
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % valores de enum que debían desaparecer', n; END IF;

  -- 3 · una sola PRINCIPAL vigente por crédito, y el índice sin predicado de caso
  SELECT count(*) INTO n FROM (
    SELECT credit_id FROM credit_assignments
     WHERE revoked_at IS NULL AND expires_at IS NULL AND kind = 'PRINCIPAL'
     GROUP BY credit_id HAVING count(*) > 1) x;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos con más de una principal vigente', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'credit_assignments_one_permanent_per_credit'
                  AND indexdef LIKE '%kind = ''PRINCIPAL''%' AND indexdef NOT LIKE '%case_id%') THEN
    RAISE EXCEPTION 'FALLO: credit_assignments_one_permanent_per_credit no tiene el predicado esperado';
  END IF;

  -- 4 · el castigo es independiente de la mora: un castigado con días de mora conserva su episodio abierto
  SELECT count(*) INTO n FROM credits c
   WHERE c.written_off_at IS NOT NULL AND c.deleted_at IS NULL AND c.days_past_due > 0 AND c.status::text NOT IN ('PAID', 'CANCELLED')
     AND NOT EXISTS (SELECT 1 FROM credit_arrear_episodes e WHERE e.credit_id = c.id AND e.ended_at IS NULL);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos castigados en mora sin episodio abierto', n; END IF;

  -- 5 · los dos triggers de episodios siguen puestos
  SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = 'credits'::regclass AND NOT tgisinternal AND tgname LIKE 'credits_arrear_episode_%';
  IF n <> 2 THEN RAISE EXCEPTION 'FALLO: faltan triggers de episodios (hay %)', n; END IF;

  -- 6 · cada cuenta conserva sus categorías de mora y los permisos nuevos existen
  FOR r IN SELECT a.id FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM arrear_categories c WHERE c.account_id = a.id) LOOP
    RAISE EXCEPTION 'FALLO: la cuenta % no tiene categorías de mora', r.id;
  END LOOP;
  SELECT count(*) INTO n FROM permissions WHERE code IN ('collection:read', 'collection:write', 'collection:export');
  IF n <> 3 THEN RAISE EXCEPTION 'FALLO: faltan permisos collection:* (hay %)', n; END IF;

  RAISE NOTICE 'OK · sin-caso-contraccion verificada';
END $$;
