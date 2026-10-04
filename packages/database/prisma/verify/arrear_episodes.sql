-- Verificación del trigger de episodios de mora (F4/07 · T11a).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/arrear_episodes.sql
--
-- Corre TODO dentro de una transacción y termina con ROLLBACK: no deja nada en la base, así que se
-- puede ejecutar contra cualquier entorno que ya tenga la migración 20261003020000. Cada escenario
-- falla con un mensaje que dice cuál fue; si llega al final imprime «OK».
--
-- Usa un tenant y un cliente cualquiera de los que existan (hace falta al menos uno de cada uno).

BEGIN;

CREATE FUNCTION pg_temp.expect(label text, ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FALLÓ: %', label; END IF;
END $$;

-- Un crédito de prueba nuevo: devuelve su id.
CREATE FUNCTION pg_temp.new_credit(
  p_id text, p_days int DEFAULT 0, p_origin text DEFAULT 'MANUAL', p_meta jsonb DEFAULT '{}',
  p_ext text DEFAULT NULL, p_sync text DEFAULT NULL, p_asof date DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE acc text; cli text;
BEGIN
  SELECT account_id, id INTO acc, cli FROM clients LIMIT 1;
  IF acc IS NULL THEN RAISE EXCEPTION 'No hay ningún cliente en la base para probar'; END IF;
  INSERT INTO credits (id, account_id, client_id, principal_amount, outstanding_balance, currency, updated_at,
                       days_past_due, origin, metadata, external_source, sync_status, reported_as_of)
  VALUES (p_id, acc, cli, 1000, 800, 'BOB', CURRENT_TIMESTAMP,
          p_days, p_origin::credit_data_origin, p_meta, p_ext, p_sync::external_sync_status, p_asof);
  RETURN p_id;
END $$;

CREATE FUNCTION pg_temp.eps(p_credit text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM credit_arrear_episodes WHERE credit_id = p_credit $$;
CREATE FUNCTION pg_temp.open_eps(p_credit text) RETURNS bigint LANGUAGE sql AS
  $$ SELECT count(*) FROM credit_arrear_episodes WHERE credit_id = p_credit AND ended_at IS NULL $$;

DO $$
DECLARE
  c text; e credit_arrear_episodes%ROWTYPE; before_ts timestamp;
BEGIN
  -- 1 · Un crédito al día no tiene episodio; al cruzar a mora, se abre.
  c := pg_temp.new_credit('t-ep-1');
  PERFORM pg_temp.expect('1a: al día no abre episodio', pg_temp.eps(c) = 0);
  UPDATE credits SET days_past_due = 5 WHERE id = c;
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('1b: se abre uno', pg_temp.open_eps(c) = 1);
  PERFORM pg_temp.expect('1c: origen CALCULATED', e.source = 'CALCULATED');
  PERFORM pg_temp.expect('1d: inicio = hoy − días, y estimado', e.started_at = CURRENT_DATE - 5 AND e.started_at_estimated);
  PERFORM pg_temp.expect('1e: días y saldo al entrar', e.start_days_past_due = 5 AND e.max_days_past_due = 5 AND e.balance_at_start = 800);
  PERFORM pg_temp.expect('1f: no es reconstruido', NOT e.reconstructed);

  -- 2 · Sigue en mora: sólo sube el pico, y no baja.
  UPDATE credits SET days_past_due = 20 WHERE id = c;
  UPDATE credits SET days_past_due = 10 WHERE id = c;
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('2a: sigue habiendo un solo episodio', pg_temp.eps(c) = 1);
  PERFORM pg_temp.expect('2b: el máximo es 20 aunque hoy lleve 10', e.max_days_past_due = 20 AND e.start_days_past_due = 5);

  -- 3 · Un pago parcial no cambia el episodio (no toca la fila).
  before_ts := e.updated_at;
  UPDATE credits SET outstanding_balance = 500 WHERE id = c;
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('3: pago parcial no reescribe el episodio', e.updated_at = before_ts AND e.balance_at_start = 800);

  -- 4 · Vuelve a cero con saldo vivo: se cierra como CURRENT, con el saldo de salida.
  UPDATE credits SET days_past_due = 0 WHERE id = c;
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('4a: cerrado', e.ended_at IS NOT NULL AND pg_temp.open_eps(c) = 0);
  PERFORM pg_temp.expect('4b: motivo CURRENT y saldo de salida', e.end_reason = 'CURRENT' AND e.balance_at_end = 500);

  -- 5 · Otra mora = otro episodio (#2), y el primero queda intacto.
  UPDATE credits SET days_past_due = 7 WHERE id = c;
  PERFORM pg_temp.expect('5a: dos episodios, uno abierto', pg_temp.eps(c) = 2 AND pg_temp.open_eps(c) = 1);
  PERFORM pg_temp.expect('5b: el primero sigue cerrado como CURRENT',
    (SELECT count(*) FROM credit_arrear_episodes WHERE credit_id = c AND end_reason = 'CURRENT') = 1);

  -- 6 · Saldar la deuda cierra con PAID.
  UPDATE credits SET status = 'PAID', outstanding_balance = 0, days_past_due = 0 WHERE id = c;
  PERFORM pg_temp.expect('6: el segundo cierra como PAID y no queda ninguno abierto',
    (SELECT count(*) FROM credit_arrear_episodes WHERE credit_id = c AND end_reason = 'PAID') = 1 AND pg_temp.open_eps(c) = 0);

  -- 7 · Una fecha de inicio DECLARADA manda y no es estimada; el origen es MANUAL.
  c := pg_temp.new_credit('t-ep-7', 3, 'MANUAL', '{"moraSince":"2026-08-20"}');
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('7: inicio declarado, MANUAL, no estimado', e.started_at = DATE '2026-08-20' AND NOT e.started_at_estimated AND e.source = 'MANUAL');

  -- 8 · Un metadata mal escrito no tumba el UPDATE: cae a la estimación.
  c := pg_temp.new_credit('t-ep-8', 4, 'MANUAL', '{"arrearsSince":"basura"}');
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('8: fecha ilegible → estimado', e.started_at = CURRENT_DATE - 4 AND e.started_at_estimated);

  -- 9 · Importado: el inicio se estima desde el CORTE del reporte, no desde hoy.
  c := pg_temp.new_credit('t-ep-9', 100, 'IMPORT', '{"origin":"import"}', 'PSF', 'PRESENT', DATE '2026-09-30');
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('9: IMPORTED, inicio = corte − días, estimado', e.source = 'IMPORTED' AND e.started_at = DATE '2026-06-22' AND e.started_at_estimated);

  -- 10 · Ausente del reporte: cierra como SOURCE_ABSENT (no es «pagó»); si vuelve, se REABRE el mismo.
  UPDATE credits SET sync_status = 'ABSENT', days_past_due = 0 WHERE id = c;
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('10a: cierra por ausencia, no por pago', e.end_reason = 'SOURCE_ABSENT' AND e.ended_at IS NOT NULL);
  UPDATE credits SET sync_status = 'PRESENT', days_past_due = 105 WHERE id = c;
  SELECT * INTO e FROM credit_arrear_episodes WHERE credit_id = c;
  PERFORM pg_temp.expect('10b: reaparece → mismo episodio reabierto, no uno nuevo', pg_temp.eps(c) = 1 AND e.ended_at IS NULL AND e.end_reason IS NULL AND e.max_days_past_due = 105);

  -- 10c · Si vuelve al reporte AL DÍA, el episodio «ausente» se resuelve (CURRENT) y una mora posterior es
  -- un episodio NUEVO: no se fusiona con el viejo.
  c := pg_temp.new_credit('t-ep-10c', 40, 'IMPORT', '{"origin":"import"}', 'PSF', 'PRESENT', DATE '2026-09-30');
  UPDATE credits SET sync_status = 'ABSENT', days_past_due = 0 WHERE id = c;
  UPDATE credits SET sync_status = 'PRESENT' WHERE id = c;
  PERFORM pg_temp.expect('10c-1: volvió al día → el episodio ausente queda CURRENT',
    (SELECT end_reason FROM credit_arrear_episodes WHERE credit_id = c) = 'CURRENT' AND pg_temp.open_eps(c) = 0);
  UPDATE credits SET days_past_due = 8 WHERE id = c;
  PERFORM pg_temp.expect('10c-2: la mora siguiente es otro episodio, no se fusiona', pg_temp.eps(c) = 2 AND pg_temp.open_eps(c) = 1);

  -- 10d · La regla set-current del importador: la mora a 0 y, en la MISMA transacción, la marca de ausente.
  -- No se «puso al día»: el episodio queda SOURCE_ABSENT, en cualquiera de los dos órdenes.
  c := pg_temp.new_credit('t-ep-10d', 1, 'IMPORT', '{"origin":"import"}', 'PSF', 'PRESENT', DATE '2026-09-29');
  UPDATE credits SET days_past_due = 0 WHERE id = c;
  UPDATE credits SET sync_status = 'ABSENT' WHERE id = c;
  PERFORM pg_temp.expect('10d-1: días a 0 y luego ausente → SOURCE_ABSENT, no CURRENT',
    (SELECT end_reason FROM credit_arrear_episodes WHERE credit_id = c) = 'SOURCE_ABSENT');
  c := pg_temp.new_credit('t-ep-10e', 1, 'IMPORT', '{"origin":"import"}', 'PSF', 'PRESENT', DATE '2026-09-29');
  UPDATE credits SET sync_status = 'ABSENT' WHERE id = c;
  UPDATE credits SET days_past_due = 0 WHERE id = c;
  PERFORM pg_temp.expect('10d-2: ausente y luego días a 0 → SOURCE_ABSENT',
    (SELECT end_reason FROM credit_arrear_episodes WHERE credit_id = c) = 'SOURCE_ABSENT');

  -- 10f · Pero una recuperación REAL anterior (otra transacción) no se reclasifica si después falta del reporte.
  c := pg_temp.new_credit('t-ep-10f', 1, 'IMPORT', '{"origin":"import"}', 'PSF', 'PRESENT', DATE '2026-09-29');
  UPDATE credits SET days_past_due = 0 WHERE id = c;
  UPDATE credit_arrear_episodes SET updated_at = CURRENT_TIMESTAMP - interval '1 day' WHERE credit_id = c; -- «ayer»
  UPDATE credits SET sync_status = 'ABSENT' WHERE id = c;
  PERFORM pg_temp.expect('10f: lo cerrado como CURRENT en una transacción anterior sigue siendo CURRENT',
    (SELECT end_reason FROM credit_arrear_episodes WHERE credit_id = c) = 'CURRENT');

  -- 11 · Castigado y borrado también cierran, con su motivo.
  c := pg_temp.new_credit('t-ep-11', 10);
  UPDATE credits SET status = 'WRITTEN_OFF' WHERE id = c;
  PERFORM pg_temp.expect('11a: WRITTEN_OFF', (SELECT end_reason FROM credit_arrear_episodes WHERE credit_id = c) = 'WRITTEN_OFF');
  c := pg_temp.new_credit('t-ep-11b', 10);
  UPDATE credits SET deleted_at = CURRENT_TIMESTAMP WHERE id = c;
  PERFORM pg_temp.expect('11b: DELETED', (SELECT end_reason FROM credit_arrear_episodes WHERE credit_id = c) = 'DELETED');

  -- 12 · Una escritura que no cambia nada no toca el historial.
  c := pg_temp.new_credit('t-ep-12', 9);
  SELECT updated_at INTO before_ts FROM credit_arrear_episodes WHERE credit_id = c;
  UPDATE credits SET days_past_due = 9, status = status WHERE id = c;
  PERFORM pg_temp.expect('12: sin cambios, sin escritura', (SELECT updated_at FROM credit_arrear_episodes WHERE credit_id = c) = before_ts AND pg_temp.eps(c) = 1);

  -- 13 · A lo sumo UN episodio abierto por crédito (la base lo exige, no sólo el trigger).
  BEGIN
    INSERT INTO credit_arrear_episodes (id, account_id, credit_id, started_at, source)
    SELECT gen_random_uuid()::text, account_id, id, CURRENT_DATE, 'CALCULATED' FROM credits WHERE id = c;
    RAISE EXCEPTION 'FALLÓ: 13: dejó abrir un segundo episodio';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 14 · «Cerrado» y «motivo» van juntos.
  BEGIN
    UPDATE credit_arrear_episodes SET ended_at = CURRENT_DATE WHERE credit_id = c;
    RAISE EXCEPTION 'FALLÓ: 14: dejó cerrar sin motivo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 15 · Una mora que sube desde cero en el INSERT también cuenta (crédito creado ya vencido).
  c := pg_temp.new_credit('t-ep-15', 30);
  PERFORM pg_temp.expect('15: nace vencido → nace con episodio', pg_temp.open_eps(c) = 1);

  -- 16 · Estados cerrados no abren episodio aunque tengan días.
  BEGIN
    c := pg_temp.new_credit('t-ep-16', 12);
    UPDATE credits SET status = 'CANCELLED', days_past_due = 12 WHERE id = c;
    PERFORM pg_temp.expect('16a: cancelado cierra', (SELECT end_reason FROM credit_arrear_episodes WHERE credit_id = c) = 'CANCELLED');
    UPDATE credits SET days_past_due = 13 WHERE id = c;
    PERFORM pg_temp.expect('16b: cancelado no se reabre por tener días', pg_temp.open_eps(c) = 0);
  END;
END $$;

SELECT 'OK: todos los escenarios del trigger de episodios de mora pasaron' AS resultado;
ROLLBACK;
