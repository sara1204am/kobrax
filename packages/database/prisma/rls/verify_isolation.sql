-- Verificación reproducible del aislamiento multi-tenant (RLS) de Kobrax.
-- Ejecutar como superuser (puede crear el tenant B de prueba):
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -f - < prisma/rls/verify_isolation.sql
-- o:  psql "$DATABASE_URL" -f prisma/rls/verify_isolation.sql
--
-- Resultado esperado:
--   superuser              → ve todos los tenants
--   kobrax_app · DEMO      → solo datos de DEMO
--   kobrax_app · Tenant B  → solo datos de B (0 casos de DEMO)
--   kobrax_app · sin ctx   → 0 filas

-- Tenant B de prueba (idempotente).
INSERT INTO accounts (id, business_name, account_type, account_status, plan_code, country_code, currency_code, created_at, updated_at)
VALUES ('acc-tenant-b', 'Tenant B', 'INDEPENDENT', 'ACTIVE', 'STARTER', 'BO', 'BOB', now(), now())
ON CONFLICT (id) DO NOTHING;
INSERT INTO clients (id, account_id, first_name, last_name, client_type, client_status, national_id, metadata, created_at, updated_at)
VALUES ('cli-b-1', 'acc-tenant-b', 'Cliente', 'B', 'PERSON', 'ACTIVE', 'B-0001', '{}', now(), now())
ON CONFLICT (id) DO NOTHING;

\echo '== superuser (sin RLS) =='
SELECT 'superuser' AS ctx, count(*) AS clients FROM clients;

SELECT id AS demo_id FROM accounts WHERE code = 'DEMO' \gset

\echo '== kobrax_app · contexto DEMO (espera clients=1, cases=1) =='
SET ROLE kobrax_app;
SELECT set_config('app.current_account_id', :'demo_id', false);
SELECT 'DEMO' AS ctx, count(*) AS clients FROM clients;
SELECT 'DEMO' AS ctx, count(*) AS cases FROM collection_cases;
RESET ROLE;

\echo '== kobrax_app · contexto Tenant B (espera clients=1, cases=0) =='
SET ROLE kobrax_app;
SELECT set_config('app.current_account_id', 'acc-tenant-b', false);
SELECT 'TenantB' AS ctx, count(*) AS clients FROM clients;
SELECT 'TenantB' AS ctx, count(*) AS cases FROM collection_cases;
RESET ROLE;

\echo '== kobrax_app · sin contexto (espera clients=0) =='
SET ROLE kobrax_app;
SELECT set_config('app.current_account_id', '', false);
SELECT 'sin-ctx' AS ctx, count(*) AS clients FROM clients;
RESET ROLE;
