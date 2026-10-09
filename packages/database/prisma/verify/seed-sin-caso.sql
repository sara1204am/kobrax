-- Verificación del seed del modelo SIN caso (F4/08 · fase 6): prisma/seed.ts.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/verify/seed-sin-caso.sql
--   pnpm db:verify:seed        (prisma db execute; no muestra los NOTICE, pero falla si algo no cumple)
--
-- Sólo LEE. Termina con RAISE EXCEPTION si el dataset no es el prometido y con un NOTICE 'OK' si lo es.
-- «Hoy» y «la semana siguiente» se calculan igual que el seed: día civil de America/La_Paz; semana siguiente
-- = lunes a viernes después de hoy (si hoy es lunes, el lunes de la semana que viene).

DO $$
DECLARE
  acc        text;
  acc2       text;
  star       text;
  today      date := (now() AT TIME ZONE 'America/La_Paz')::date;
  next_mon   date;
  n          bigint;
  m          bigint;
  k          bigint;
  n2         bigint;
  t          text;
BEGIN
  next_mon := today + (8 - extract(isodow FROM today)::int);

  SELECT id INTO acc  FROM accounts WHERE code = 'DEMO';
  SELECT id INTO acc2 FROM accounts WHERE code = 'DEMO2';
  IF acc IS NULL OR acc2 IS NULL THEN RAISE EXCEPTION 'FALLO: faltan las cuentas DEMO / DEMO2'; END IF;
  SELECT id INTO star FROM credits WHERE account_id = acc AND code = 'CRD-DEMO-0001';
  IF star IS NULL THEN RAISE EXCEPTION 'FALLO: no existe el crédito completo CRD-DEMO-0001'; END IF;

  -- ── Agenda: UN solo vencido en toda la base ──
  SELECT count(*) INTO n FROM agenda_items WHERE status::text = 'SCHEDULED' AND deleted_at IS NULL AND scheduled_date < today;
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO: debe haber exactamente 1 agendado vencido (SCHEDULED con fecha < hoy) y hay %', n; END IF;
  SELECT count(*) INTO n FROM agenda_items a JOIN credits c ON c.id = a.credit_id
   WHERE a.status::text = 'SCHEDULED' AND a.deleted_at IS NULL AND a.scheduled_date < today AND a.type::text = 'PROMISE_TO_PAY'
     AND a.assignee_id = c.assigned_manager_id AND c.id = star;
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO: el agendado vencido debe ser la promesa de la estrella, a cargo del cobrador principal'; END IF;

  -- ── Agenda de la semana siguiente (lunes a viernes) ──
  SELECT count(*), count(DISTINCT type), count(DISTINCT scheduled_date) INTO n, m, k
    FROM agenda_items WHERE account_id = acc AND status::text = 'SCHEDULED' AND deleted_at IS NULL
     AND scheduled_date BETWEEN next_mon AND next_mon + 4;
  IF n < 6 THEN RAISE EXCEPTION 'FALLO: la semana siguiente (% a %) tiene % agendados (mínimo 6)', next_mon, next_mon + 4, n; END IF;
  IF m < 4 THEN RAISE EXCEPTION 'FALLO: la semana siguiente tiene % tipos distintos (mínimo 4)', m; END IF;
  IF k < 4 THEN RAISE EXCEPTION 'FALLO: la semana siguiente cubre % días distintos (mínimo 4)', k; END IF;
  SELECT count(DISTINCT assignee_id) INTO n FROM agenda_items
   WHERE account_id = acc AND status::text = 'SCHEDULED' AND deleted_at IS NULL AND scheduled_date BETWEEN next_mon AND next_mon + 4;
  IF n < 3 THEN RAISE EXCEPTION 'FALLO: la semana siguiente debe repartirse entre al menos 3 cobradores (hay %)', n; END IF;

  -- ── La estrella: gestiones, promesas, notas, pagos, episodios, responsables ──
  SELECT count(*) INTO n FROM credit_activities WHERE credit_id = star;
  IF n < 18 THEN RAISE EXCEPTION 'FALLO: la estrella tiene % gestiones (mínimo 18)', n; END IF;
  SELECT count(DISTINCT type) INTO n FROM credit_activities WHERE credit_id = star AND type::text IN ('CALL', 'VISIT', 'MESSAGE', 'NOTE', 'ASSIGNMENT');
  IF n <> 5 THEN RAISE EXCEPTION 'FALLO: la estrella debe tener gestiones de los 5 tipos CALL/VISIT/MESSAGE/NOTE/ASSIGNMENT (hay %)', n; END IF;
  SELECT count(*) INTO n FROM credit_activities WHERE credit_id = star AND result IN ('CONTACTED', 'PROMISE_TO_PAY', 'PROMISE_KEPT');
  SELECT count(*) INTO m FROM credit_activities WHERE credit_id = star AND result IN ('NO_ANSWER', 'WRONG_NUMBER', 'NOT_FOUND', 'REFUSAL', 'PROMISE_BROKEN');
  IF n = 0 OR m = 0 THEN RAISE EXCEPTION 'FALLO: la estrella necesita resultados logrados (%) y fallidos (%)', n, m; END IF;
  SELECT count(*) INTO n FROM credit_activities WHERE credit_id = star AND created_at < now() - interval '61 days';
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % gestiones de la estrella fuera de los últimos 60 días', n; END IF;
  SELECT count(*) INTO n FROM credit_activities WHERE credit_id = star AND episode_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % gestiones de la estrella sin episodio', n; END IF;

  -- Promesas en TODOS los estados (misma derivación que `promiseStatus` de la API).
  WITH p AS (
    SELECT CASE a.status::text
             WHEN 'EXECUTED'    THEN CASE ca.result WHEN 'PROMISE_KEPT' THEN 'KEPT' WHEN 'PROMISE_BROKEN' THEN 'BROKEN' ELSE 'EXECUTED' END
             WHEN 'CANCELLED'   THEN 'CANCELLED'
             WHEN 'RESCHEDULED' THEN 'RESCHEDULED'
             ELSE CASE WHEN a.scheduled_date >= today THEN 'ACTIVE' ELSE 'OVERDUE' END
           END AS st
      FROM agenda_items a LEFT JOIN credit_activities ca ON ca.id = a.result_activity_id
     WHERE a.credit_id = star AND a.type::text = 'PROMISE_TO_PAY' AND a.deleted_at IS NULL)
  SELECT count(DISTINCT st) FILTER (WHERE st IN ('KEPT', 'BROKEN', 'CANCELLED', 'RESCHEDULED', 'ACTIVE', 'OVERDUE')) INTO n FROM p;
  IF n <> 6 THEN RAISE EXCEPTION 'FALLO: la estrella debe tener promesas KEPT, BROKEN, CANCELLED, RESCHEDULED, ACTIVE y OVERDUE (estados distintos: %)', n; END IF;

  -- Post-its: las 7 secciones, varios colores y los tres tipos.
  SELECT count(DISTINCT anchor) INTO n FROM credit_notes WHERE credit_id = star AND deleted_at IS NULL;
  IF n <> 7 THEN RAISE EXCEPTION 'FALLO: las notas de la estrella deben cubrir los 7 anclajes (cubren %)', n; END IF;
  SELECT count(DISTINCT color), count(DISTINCT kind) INTO n, m FROM credit_notes WHERE credit_id = star AND deleted_at IS NULL;
  IF n < 4 OR m <> 3 THEN RAISE EXCEPTION 'FALLO: notas de la estrella con % colores (mín. 4) y % tipos (deben ser 3)', n, m; END IF;

  -- Pagos: ≥6, ≥3 medios, los dos canales, con comprobante.
  SELECT count(*), count(DISTINCT method), count(DISTINCT channel), count(*) FILTER (WHERE receipt_number IS NULL) INTO n, m, k, n2 FROM payments WHERE credit_id = star;
  IF n < 6 THEN RAISE EXCEPTION 'FALLO: la estrella tiene % pagos (mínimo 6)', n; END IF;
  IF m < 3 THEN RAISE EXCEPTION 'FALLO: la estrella tiene pagos con % medios (mínimo 3)', m; END IF;
  IF k <> 2 THEN RAISE EXCEPTION 'FALLO: la estrella debe tener pagos de los dos canales (KOBRAX_COLLECTED y EXTERNAL_CONFIRMED); hay %', k; END IF;
  IF n2 > 0 THEN RAISE EXCEPTION 'FALLO: % pagos de la estrella sin número de comprobante', n2; END IF;

  -- Episodios: 3 (2 cerrados, 1 abierto); categoría B (31–60) y prioridad en el abierto.
  SELECT count(*), count(*) FILTER (WHERE ended_at IS NULL) INTO n, m FROM credit_arrear_episodes WHERE credit_id = star;
  IF n <> 3 OR m <> 1 THEN RAISE EXCEPTION 'FALLO: la estrella debe tener 3 episodios con 1 abierto (hay % con % abiertos)', n, m; END IF;
  SELECT count(*) INTO n FROM credits c JOIN arrear_categories k ON k.account_id = c.account_id AND c.days_past_due >= k.from_days AND (k.to_days IS NULL OR c.days_past_due <= k.to_days)
   WHERE c.id = star AND k.code = 'B';
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO: la estrella debe estar en la categoría B'; END IF;
  SELECT count(*) INTO n FROM credit_arrear_episodes WHERE credit_id = star AND ended_at IS NULL AND priority IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO: el episodio abierto de la estrella no tiene prioridad'; END IF;

  -- Responsables: PRINCIPAL + APOYO + TEMPORAL vigentes, la temporal con vencimiento futuro y su marca en la agenda pendiente.
  SELECT count(DISTINCT kind) INTO n FROM credit_assignments WHERE credit_id = star AND revoked_at IS NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'FALLO: la estrella debe tener los tres tipos de asignación vigentes (hay %)', n; END IF;
  SELECT count(*) INTO n FROM credit_assignments WHERE credit_id = star AND kind::text = 'TEMPORAL' AND revoked_at IS NULL AND expires_at > now();
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO: la estrella necesita un reemplazo temporal vigente con vencimiento futuro'; END IF;
  SELECT count(*) INTO n FROM agenda_items a JOIN credit_assignments x ON x.credit_id = a.credit_id AND x.kind::text = 'TEMPORAL' AND x.revoked_at IS NULL
   WHERE a.credit_id = star AND a.details->>'handoffAssignmentId' = x.id AND a.details ? 'handoffFromUserId' AND a.assignee_id = x.user_id AND a.status::text = 'SCHEDULED';
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: ningún agendado pendiente de la estrella lleva la marca de traspaso al reemplazo temporal'; END IF;

  -- Persona: contactos (teléfono/WhatsApp/correo) y ubicaciones con coordenadas; garante, familia, compañero, vecino; garantías.
  SELECT count(DISTINCT contact_type) INTO n FROM client_contacts k JOIN credits c ON c.client_id = k.client_id WHERE c.id = star AND k.relation_id IS NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'FALLO: la persona debe tener contactos PHONE, WHATSAPP y EMAIL (tiene % tipos)', n; END IF;
  SELECT count(*) INTO n FROM client_locations l JOIN credits c ON c.client_id = l.client_id WHERE c.id = star AND l.latitude IS NOT NULL AND l.longitude IS NOT NULL;
  IF n < 3 THEN RAISE EXCEPTION 'FALLO: la persona y sus relaciones deben tener ubicaciones con coordenadas (hay %)', n; END IF;
  SELECT count(DISTINCT r.relationship_type) INTO n FROM client_relations r JOIN credits c ON c.client_id = r.client_id WHERE c.id = star
   AND r.relationship_type::text IN ('GUARANTOR', 'FAMILY', 'COWORKER', 'NEIGHBOR');
  IF n <> 4 THEN RAISE EXCEPTION 'FALLO: faltan relaciones (garante, familia, compañero, vecino): hay %', n; END IF;
  SELECT count(*) INTO n FROM credit_guarantors WHERE credit_id = star;
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: el garante no está enlazado al crédito'; END IF;
  SELECT count(*) INTO n FROM collateral_credits WHERE credit_id = star;
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: la estrella no tiene garantías'; END IF;
  SELECT count(*) INTO n FROM client_relations r JOIN credits c ON c.client_id = r.client_id AND c.id = star
   WHERE NOT EXISTS (SELECT 1 FROM client_contacts k WHERE k.relation_id = r.id) OR NOT EXISTS (SELECT 1 FROM client_locations l WHERE l.relation_id = r.id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % relaciones de la estrella sin contacto o sin ubicación', n; END IF;

  -- ── Categorías de mora para cada cuenta, y cubiertas A, B y C por créditos en mora de la app ──
  SELECT count(*) INTO n FROM (SELECT account_id FROM arrear_categories GROUP BY account_id HAVING count(*) FILTER (WHERE code IN ('A', 'B', 'C')) = 3) x;
  SELECT count(*) INTO m FROM accounts WHERE deleted_at IS NULL AND code IN ('DEMO', 'DEMO2');
  IF n < m THEN RAISE EXCEPTION 'FALLO: cada cuenta demo necesita las categorías A, B y C'; END IF;
  FOREACH t IN ARRAY ARRAY['A', 'B', 'C'] LOOP
    SELECT count(*) INTO n FROM credits c
      JOIN arrear_categories k ON k.account_id = c.account_id AND c.days_past_due >= k.from_days AND (k.to_days IS NULL OR c.days_past_due <= k.to_days)
     WHERE c.account_id = acc AND c.deleted_at IS NULL AND c.days_past_due > 0 AND c.external_source IS NULL AND k.code = t
       AND EXISTS (SELECT 1 FROM credit_arrear_episodes e WHERE e.credit_id = c.id AND e.ended_at IS NULL);
    IF n < 1 THEN RAISE EXCEPTION 'FALLO: ningún crédito de la app en mora de categoría % con episodio abierto', t; END IF;
  END LOOP;

  -- ── Cartera de la app: al día / mora / castigado; origen y sin fuente externa ──
  SELECT count(*) INTO n FROM credits WHERE account_id = acc AND external_source IS NULL AND origin::text = 'MANUAL' AND days_past_due = 0 AND status::text = 'ACTIVE' AND deleted_at IS NULL;
  IF n < 7 THEN RAISE EXCEPTION 'FALLO: faltan créditos de la app al día (hay %, mínimo 7)', n; END IF;
  SELECT count(*) INTO n FROM credits WHERE account_id = acc AND written_off_at IS NOT NULL AND days_past_due >= 240;
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: falta el crédito castigado (written_off_at) que sigue en mora 240+ días'; END IF;
  SELECT count(*) INTO n FROM credits c WHERE c.account_id = acc AND c.external_source IS NULL AND c.status::text <> 'PAID'
    AND NOT EXISTS (SELECT 1 FROM credit_installments i WHERE i.credit_id = c.id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos de la app sin cronograma', n; END IF;
  SELECT count(*) INTO n FROM credits c JOIN credit_arrear_episodes e ON e.credit_id = c.id AND e.ended_at IS NULL
   WHERE c.account_id = acc AND c.written_off_at IS NOT NULL;
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: el castigado debe conservar su episodio de mora abierto'; END IF;

  -- ── Importados PSF ──
  SELECT count(*) INTO n FROM credits WHERE account_id = acc AND external_source = 'PSF' AND origin::text = 'IMPORT' AND deleted_at IS NULL;
  IF n < 6 THEN RAISE EXCEPTION 'FALLO: faltan créditos PSF (hay %, mínimo 6)', n; END IF;
  SELECT count(*) INTO n FROM credits WHERE account_id = acc AND external_source = 'PSF' AND sync_status::text = 'ABSENT' AND absent_since IS NOT NULL;
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: falta un PSF ausente del reporte (sync_status ABSENT con absent_since)'; END IF;
  SELECT count(*) INTO n FROM credits c JOIN accounts a ON a.id = c.account_id
   WHERE c.account_id = acc AND c.external_source = 'PSF' AND c.sync_status::text = 'PRESENT' AND c.reported_as_of IS NOT NULL
     AND c.days_past_due > 0
     AND today - c.reported_as_of > COALESCE((a.configuration->'importConfig'->>'staleAfterDays')::int, 2);
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: falta un PSF con dato viejo (reported_as_of más viejo que staleAfterDays)'; END IF;
  SELECT count(*) INTO n FROM clients WHERE account_id = acc AND link_review_pending;
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: falta un cliente provisional (link_review_pending)'; END IF;
  SELECT count(*) INTO n FROM credits c WHERE c.account_id = acc AND c.external_source = 'PSF'
    AND (c.metadata->>'reportedStatus' IS NULL OR c.metadata->>'pastDueAmount' IS NULL OR c.metadata->>'installmentAmount' IS NULL
         OR c.metadata->>'nextDueDate' IS NULL OR c.metadata->>'balanceBasis' IS NULL);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % PSF sin metadatos reportados completos', n; END IF;
  SELECT count(*) INTO n FROM external_advisor_links l JOIN users u ON u.id = l.user_id
   WHERE l.account_id = acc AND l.external_source = 'PSF' AND l.advisor_code = 'CQE' AND l.deleted_at IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FALLO: el asesor CQE debe estar vinculado a un cobrador'; END IF;
  IF (SELECT configuration->'importConfig' FROM accounts WHERE id = acc) IS NULL THEN RAISE EXCEPTION 'FALLO: la cuenta DEMO no tiene importConfig'; END IF;
  -- 3 corridas en días consecutivos del mismo asesor, con movimientos y snapshots.
  SELECT count(*) INTO n FROM (
    SELECT report_as_of, report_as_of - (row_number() OVER (ORDER BY report_as_of))::int AS grp
      FROM client_import_runs WHERE account_id = acc AND advisor_code = 'CQE' AND external_source = 'PSF') x
   GROUP BY grp ORDER BY count(*) DESC LIMIT 1;
  IF coalesce(n, 0) < 3 THEN RAISE EXCEPTION 'FALLO: se esperaban 3 corridas CQE en días consecutivos (la racha más larga es %)', coalesce(n, 0); END IF;
  SELECT count(*) INTO n FROM client_import_runs r WHERE r.account_id = acc AND r.external_source = 'PSF'
    AND (NOT EXISTS (SELECT 1 FROM client_import_run_items i WHERE i.run_id = r.id) OR NOT EXISTS (SELECT 1 FROM credit_external_snapshots s WHERE s.run_id = r.id));
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % corridas sin movimientos o sin snapshots', n; END IF;
  SELECT count(*) INTO n FROM credits c WHERE c.account_id = acc AND c.external_source = 'PSF' AND NOT EXISTS (SELECT 1 FROM credit_external_snapshots s WHERE s.credit_id = c.id);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % PSF sin ningún snapshot', n; END IF;

  -- ── Responsables: todo crédito vivo tiene responsable y su fila PRINCIPAL; reparto entre ambas agencias; supervisor dueño ──
  SELECT count(*) INTO n FROM credits c WHERE c.deleted_at IS NULL AND c.account_id IN (acc, acc2)
    AND (c.assigned_manager_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM credit_assignments a WHERE a.credit_id = c.id AND a.kind::text = 'PRINCIPAL' AND a.revoked_at IS NULL AND a.user_id = c.assigned_manager_id));
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos sin responsable o sin su fila PRINCIPAL', n; END IF;
  SELECT count(DISTINCT ua.branch_id) INTO n FROM credits c JOIN user_accounts ua ON ua.user_id = c.assigned_manager_id AND ua.account_id = c.account_id
   WHERE c.account_id = acc AND ua.branch_id IS NOT NULL;
  IF n < 2 THEN RAISE EXCEPTION 'FALLO: los créditos deben repartirse entre responsables de las dos agencias (hay %)', n; END IF;
  SELECT count(*) INTO n FROM credits c JOIN user_accounts ua ON ua.user_id = c.assigned_manager_id AND ua.account_id = c.account_id JOIN roles r ON r.id = ua.role_id
   WHERE c.account_id = acc AND r.name = 'SUPERVISOR';
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: ningún crédito está a cargo de un supervisor'; END IF;
  SELECT count(*) INTO n FROM credits c WHERE c.account_id = acc AND c.deleted_at IS NULL AND c.branch_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos de DEMO sin agencia', n; END IF;

  -- ── Agencias: cada una con su supervisor; 3 cobradores en la 1, 2 en la 2; gerente y administrador ──
  SELECT count(*) INTO n FROM user_accounts ua JOIN roles r ON r.id = ua.role_id
   WHERE ua.account_id = acc AND r.name IN ('COLLECTOR', 'SUPERVISOR') AND ua.is_active AND ua.branch_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % cobradores/supervisores de DEMO sin branch_id', n; END IF;
  SELECT count(*) INTO n FROM (
    SELECT ua.branch_id FROM user_accounts ua JOIN roles r ON r.id = ua.role_id
     WHERE ua.account_id = acc AND r.name = 'SUPERVISOR' AND ua.branch_id IS NOT NULL GROUP BY ua.branch_id) x;
  IF n < 2 THEN RAISE EXCEPTION 'FALLO: debe haber un supervisor en cada una de las 2 agencias (agencias con supervisor: %)', n; END IF;
  -- Cobradores con agencia: los 5 de la demo (3 en Central, 2 en El Alto) más las cuentas del QA (cobrador5 a cobrador10).
  -- Cada agencia debe tener al menos los de la demo, y NINGÚN cobrador puede quedar sin agencia.
  SELECT count(*) INTO n FROM user_accounts ua JOIN roles r ON r.id = ua.role_id
   WHERE ua.account_id = acc AND r.name = 'COLLECTOR' AND ua.branch_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: hay % cobrador(es) sin agencia', n; END IF;
  SELECT min(c) INTO n FROM (
    SELECT count(*) AS c FROM user_accounts ua JOIN roles r ON r.id = ua.role_id
     WHERE ua.account_id = acc AND r.name = 'COLLECTOR' AND ua.branch_id IS NOT NULL GROUP BY ua.branch_id) x;
  IF n < 2 THEN RAISE EXCEPTION 'FALLO: cada agencia debe tener al menos 2 cobradores (mínimo %)', n; END IF;
  SELECT count(*) INTO n FROM user_accounts ua JOIN roles r ON r.id = ua.role_id WHERE ua.account_id = acc AND r.name = 'MANAGER';
  SELECT count(*) INTO m FROM user_accounts ua JOIN roles r ON r.id = ua.role_id WHERE ua.account_id = acc AND r.name = 'ACCOUNT_ADMIN';
  IF n < 1 OR m < 1 THEN RAISE EXCEPTION 'FALLO: faltan el gerente (%) o el administrador (%)', n, m; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE email = 'collector@kobrax.demo') OR NOT EXISTS (SELECT 1 FROM users WHERE email = 'supervisor@kobrax.demo') THEN
    RAISE EXCEPTION 'FALLO: faltan collector@kobrax.demo o supervisor@kobrax.demo';
  END IF;
  -- Alcance del supervisor (D8): data:scope:branch y no data:scope:all; collection:* repartidos.
  SELECT count(*) INTO n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'SUPERVISOR' AND p.code = 'data:scope:branch';
  SELECT count(*) INTO m FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'SUPERVISOR' AND p.code = 'data:scope:all';
  IF n <> 1 OR m <> 0 THEN RAISE EXCEPTION 'FALLO: el SUPERVISOR debe tener data:scope:branch y no data:scope:all'; END IF;
  SELECT count(DISTINCT p.code) INTO n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name = 'SUPERVISOR' AND p.code IN ('collection:read', 'collection:write', 'collection:export');
  IF n <> 3 THEN RAISE EXCEPTION 'FALLO: el SUPERVISOR no tiene collection:read/write/export'; END IF;

  -- ── Aislamiento: DEMO2 pequeña y con sus propios datos ──
  SELECT count(*) INTO n FROM credits WHERE account_id = acc2;
  IF n < 1 OR n > 5 THEN RAISE EXCEPTION 'FALLO: DEMO2 debe ser pequeña (créditos: %)', n; END IF;
  SELECT count(*) INTO n FROM credits c JOIN clients k ON k.id = c.client_id WHERE c.account_id <> k.account_id;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos cruzan cuentas con su cliente', n; END IF;

  -- ── Catálogos ──
  SELECT count(DISTINCT catalog) INTO n FROM catalog_items WHERE account_id = acc AND catalog::text IN ('PAYMENT_METHOD', 'BANK', 'PRIORITY', 'CANCEL_REASON', 'RESCHEDULE_REASON', 'EXPECTED_RESULT');
  IF n <> 6 THEN RAISE EXCEPTION 'FALLO: faltan catálogos de la cuenta DEMO'; END IF;

  -- ── Rutas: por crédito, sin caso ──
  SELECT count(*) INTO n FROM route_stops s JOIN route_plans p ON p.id = s.route_id
   WHERE p.account_id = acc AND p.planned_date = today AND s.credit_id IS NOT NULL;
  IF n < 3 THEN RAISE EXCEPTION 'FALLO: la ruta de hoy debe tener paradas por crédito (hay %)', n; END IF;
  SELECT count(*) INTO n FROM route_stops WHERE credit_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % paradas de ruta sin credit_id', n; END IF;
  SELECT count(*) INTO n FROM field_visits WHERE credit_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % visitas sin credit_id', n; END IF;
  SELECT count(*) INTO n FROM field_visits WHERE account_id = acc AND credit_id IS NOT NULL;
  IF n < 4 THEN RAISE EXCEPTION 'FALLO: faltan visitas de campo por crédito (hay %)', n; END IF;
  SELECT count(*) INTO n FROM notifications WHERE account_id = acc AND credit_id IS NOT NULL;
  IF n < 3 THEN RAISE EXCEPTION 'FALLO: faltan avisos (hay %)', n; END IF;

  -- ── Episodios abiertos coherentes con el estado del crédito (mismas invariantes que arrear-episodes.it) ──
  SELECT count(*) INTO n FROM credits c
   WHERE c.deleted_at IS NULL AND c.days_past_due > 0 AND c.status::text NOT IN ('PAID', 'CANCELLED')
     AND NOT EXISTS (SELECT 1 FROM credit_arrear_episodes e WHERE e.credit_id = c.id AND e.ended_at IS NULL);
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % créditos en mora sin episodio abierto', n; END IF;
  SELECT count(*) INTO n FROM credit_arrear_episodes e JOIN credits c ON c.id = e.credit_id
   WHERE e.ended_at IS NULL AND NOT (c.deleted_at IS NULL AND c.days_past_due > 0 AND c.status::text NOT IN ('PAID', 'CANCELLED'));
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % episodios abiertos en créditos que no están en mora', n; END IF;
  SELECT count(*) INTO n FROM credits c JOIN credit_arrear_episodes e ON e.credit_id = c.id
   WHERE c.sync_status::text = 'ABSENT' AND e.end_reason::text = 'SOURCE_ABSENT';
  IF n < 1 THEN RAISE EXCEPTION 'FALLO: el PSF ausente debe tener su episodio cerrado con motivo SOURCE_ABSENT'; END IF;

  -- ── Fechas relativas: nada sembrado en el futuro lejano ni gestiones del futuro ──
  SELECT count(*) INTO n FROM credit_activities WHERE created_at > now();
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % gestiones con fecha futura', n; END IF;
  SELECT count(*) INTO n FROM payments WHERE payment_date > now();
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % pagos con fecha futura', n; END IF;

  -- ── Sin caso: no queda ninguna tabla ni columna del caso ──
  FOREACH t IN ARRAY ARRAY['collection_cases', 'case_activities'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN RAISE EXCEPTION 'FALLO: la tabla % sigue existiendo', t; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'case_id';
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % columnas case_id siguen existiendo', n; END IF;

  RAISE NOTICE 'OK · seed-sin-caso verificado (hoy %, semana siguiente % a %)', today, next_mon, next_mon + 4;
END $$;
