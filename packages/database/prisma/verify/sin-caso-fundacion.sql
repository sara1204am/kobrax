-- Verificación de la migración 20261004000000_sin_caso_fundacion (F4/08 · fase 1).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/sin-caso-fundacion.sql
--   (docker: docker exec -i kobrax-postgres psql -U postgres -d kobrax -v ON_ERROR_STOP=1 -f - < prisma/verify/sin-caso-fundacion.sql)
--
-- Sólo LEE (no escribe nada). Imprime los números y termina con un error si algo no cuadra.
-- Vale mientras existan `case_activities` y `collection_cases` (hasta la fase 6).

\echo '== Conteos =='
SELECT
  (SELECT count(*) FROM case_activities)   AS case_activities,
  (SELECT count(*) FROM credit_activities) AS credit_activities,
  (SELECT count(*) FROM credit_activities WHERE episode_id IS NOT NULL) AS con_episodio,
  (SELECT count(*) FROM credit_activities WHERE notes LIKE 'Cambio de estado%') AS cambios_de_estado;

\echo '== Agenda: result_activity_id que resuelven =='
SELECT
  (SELECT count(*) FROM agenda_items WHERE result_activity_id IS NOT NULL) AS con_resultado,
  (SELECT count(*) FROM agenda_items a JOIN credit_activities c ON c.id = a.result_activity_id) AS resuelven_en_credit_activities;

\echo '== Castigo, categorías, permisos, asignaciones, credit_id =='
SELECT
  (SELECT count(*) FROM credits WHERE status::text = 'WRITTEN_OFF') AS castigados,
  (SELECT count(*) FROM credits WHERE status::text = 'WRITTEN_OFF' AND written_off_at IS NOT NULL) AS castigados_con_fecha,
  (SELECT count(*) FROM credits WHERE last_action_at IS NOT NULL) AS con_ultima_gestion,
  (SELECT count(*) FROM accounts) AS cuentas,
  (SELECT count(*) FROM arrear_categories) AS categorias,
  (SELECT count(*) FROM credit_arrear_episodes WHERE ended_at IS NULL AND priority IS NOT NULL) AS episodios_abiertos_con_prioridad,
  (SELECT count(*) FROM credit_assignments WHERE kind = 'TEMPORAL') AS asignaciones_temporales;

SELECT p.code, (SELECT count(*) FROM role_permissions rp WHERE rp.permission_id = p.id) AS roles
FROM permissions p WHERE p.code IN ('case:read', 'collection:read', 'case:write', 'collection:write', 'case:export', 'collection:export')
ORDER BY p.code;

DO $$
DECLARE
  n bigint;
  m bigint;
  r record;
BEGIN
  -- 1 · una actividad por cada actividad del caso (mismos ids)
  SELECT count(*) INTO n FROM case_activities ca WHERE NOT EXISTS (SELECT 1 FROM credit_activities c WHERE c.id = ca.id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % case_activities sin su credit_activities', n; END IF;
  SELECT count(*) INTO n FROM case_activities;
  SELECT count(*) INTO m FROM credit_activities;
  IF m < n THEN RAISE EXCEPTION 'FALLO: credit_activities (%) < case_activities (%)', m, n; END IF;

  -- 2 · ningún result_activity_id quedó colgando
  SELECT count(*) INTO n FROM agenda_items a
   WHERE a.result_activity_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM credit_activities c WHERE c.id = a.result_activity_id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % agenda_items con result_activity_id que no resuelve', n; END IF;

  -- 3 · ninguna actividad sin crédito (la FK lo impide, se comprueba igual) ni con crédito de otra cuenta
  SELECT count(*) INTO n FROM credit_activities c LEFT JOIN credits cr ON cr.id = c.credit_id
   WHERE cr.id IS NULL OR cr.account_id <> c.account_id;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % credit_activities sin crédito o de otra cuenta', n; END IF;

  -- 4 · todo castigado tiene fecha de castigo
  SELECT count(*) INTO n FROM credits WHERE status::text = 'WRITTEN_OFF' AND written_off_at IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos WRITTEN_OFF sin written_off_at', n; END IF;

  -- 5 · cada cuenta tiene exactamente las 3 categorías A/B/C iniciales (o las que editó, pero ≥ 1)
  FOR r IN SELECT a.id, count(c.id) AS k FROM accounts a LEFT JOIN arrear_categories c ON c.account_id = a.id GROUP BY a.id LOOP
    IF r.k < 1 THEN RAISE EXCEPTION 'FALLO: la cuenta % no tiene categorías de mora', r.id; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM accounts a
   WHERE (SELECT count(*) FROM arrear_categories c WHERE c.account_id = a.id AND c.code IN ('A', 'B', 'C')) <> 3;
  IF n > 0 THEN RAISE NOTICE 'AVISO: % cuenta(s) sin las 3 categorías A/B/C originales (¿editadas?)', n; END IF;

  -- 6 · los permisos nuevos son copia de los viejos: mismos roles y mismos overrides
  FOR r IN SELECT unnest(ARRAY['read', 'write', 'export']) AS p LOOP
    SELECT count(*) INTO n FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'case:' || r.p;
    SELECT count(*) INTO m FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE p.code = 'collection:' || r.p;
    IF n <> m THEN RAISE EXCEPTION 'FALLO: case:% tiene % roles y collection:% tiene %', r.p, n, r.p, m; END IF;
    SELECT count(*) INTO n FROM user_permission_overrides o JOIN permissions p ON p.id = o.permission_id WHERE p.code = 'case:' || r.p;
    SELECT count(*) INTO m FROM user_permission_overrides o JOIN permissions p ON p.id = o.permission_id WHERE p.code = 'collection:' || r.p;
    IF n <> m THEN RAISE EXCEPTION 'FALLO: overrides de case:% = %, de collection:% = %', r.p, n, r.p, m; END IF;
  END LOOP;

  -- 7 · una sola PRINCIPAL vigente por crédito (el índice parcial lo impone; se comprueba el dato)
  SELECT count(*) INTO n FROM (
    SELECT credit_id FROM credit_assignments
     WHERE revoked_at IS NULL AND expires_at IS NULL AND case_id IS NULL AND kind = 'PRINCIPAL'
     GROUP BY credit_id HAVING count(*) > 1) x;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos con más de una principal vigente', n; END IF;

  -- 8 · credit_id de visitas, paradas y notificaciones: nada con caso quedó sin crédito
  SELECT count(*) INTO n FROM field_visits WHERE case_id IS NOT NULL AND credit_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % field_visits con case_id y sin credit_id', n; END IF;
  SELECT count(*) INTO n FROM route_stops WHERE case_id IS NOT NULL AND credit_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % route_stops con case_id y sin credit_id', n; END IF;
  SELECT count(*) INTO n FROM notifications WHERE case_id IS NOT NULL AND credit_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % notifications con case_id y sin credit_id', n; END IF;

  -- 9 · agenda_items.case_id admite NULL
  IF (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'agenda_items' AND column_name = 'case_id') <> 'YES' THEN
    RAISE EXCEPTION 'FALLO: agenda_items.case_id sigue NOT NULL';
  END IF;

  RAISE NOTICE 'OK · sin-caso-fundacion verificada';
END $$;
