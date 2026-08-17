-- Seed de CARGA para medir la cartera a escala (F9 · refactor de Cartera, §B5.5).
--
-- 100.000 personas y ~300.000 créditos en un tenant propio (`perf-tenant`), para poder medir
-- búsqueda, filtros sobre agregados, orden y paginación con números reales. Va en su propia cuenta
-- a propósito: el tenant de demo se sigue usando para validar a ojo, y meterle 100.000 clientes lo
-- volvería inservible para eso.
--
-- Es SQL crudo y no un seed de Prisma **porque son 400.000 filas**: con `prisma.create` por fila
-- esto tarda horas; así tarda segundos. No inserta PII real (el documento va en NULL): lo que se
-- mide es el costo de agregar, no el de descifrar.
--
-- Correr:  docker cp seed-perf.sql kobrax-postgres:/tmp/ && docker exec kobrax-postgres psql -U postgres -d kobrax -f /tmp/seed-perf.sql
-- Borrar:  DELETE FROM credits WHERE account_id = 'perf-tenant'; DELETE FROM clients WHERE account_id = 'perf-tenant';

INSERT INTO accounts (id, business_name, account_type, account_status, plan_code, country_code, currency_code, updated_at)
VALUES ('perf-tenant', 'Tenant de carga', 'FINANCIAL_INSTITUTION', 'ACTIVE', 'ENTERPRISE', 'BO', 'BOB', now())
ON CONFLICT (id) DO NOTHING;

-- 100.000 personas. Los nombres se reparten sobre un puñado de apellidos para que la búsqueda por
-- texto tenga que descartar de verdad (con nombres únicos, cualquier ILIKE devuelve una fila y la
-- medición miente).
INSERT INTO clients (id, account_id, first_name, last_name, client_type, client_status, risk_segment, created_at, updated_at)
SELECT
  'perf-c-' || i,
  'perf-tenant',
  (ARRAY['Edgar','Maria','Juan','Rosa','Luis','Ana','Carlos','Elena'])[1 + (i % 8)],
  (ARRAY['Mamani','Quispe','Vargas','Choque','Flores','Rojas'])[1 + (i % 6)] || ' ' || i,
  'PERSON',
  (ARRAY['ACTIVE','ACTIVE','ACTIVE','INACTIVE'])[1 + (i % 4)]::"ClientStatus",
  (ARRAY['LOW','MEDIUM','HIGH'])[1 + (i % 3)],
  now() - (i || ' minutes')::interval,
  now()
FROM generate_series(1, 100000) i;

-- ~300.000 créditos: 1 a 5 por persona, con mora y saldo repartidos para que los filtros de rango
-- corten pedazos distintos de la cartera y no todo o nada.
INSERT INTO credits (id, account_id, client_id, principal_amount, outstanding_balance, currency, installments_count, status, days_past_due, created_at, updated_at)
SELECT
  'perf-k-' || i || '-' || n,
  'perf-tenant',
  'perf-c-' || i,
  1000 + (i % 40) * 500,
  100 + ((i * 7 + n) % 900) * 50,
  'BOB',
  12,
  'ACTIVE'::"CreditStatus",
  CASE WHEN (i + n) % 3 = 0 THEN 0 ELSE (i * 13 + n * 7) % 460 END,
  now(),
  now()
FROM generate_series(1, 100000) i,
     LATERAL generate_series(1, 1 + (i % 5)) n;

ANALYZE clients;
ANALYZE credits;
