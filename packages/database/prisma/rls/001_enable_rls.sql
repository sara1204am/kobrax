-- Kobrax · Row Level Security (multi-tenant)
-- Aislamiento total por tenant. La API setea el contexto antes de cada query:
--   SET LOCAL app.current_account_id = '<uuid>'
--
-- Aplicar DESPUÉS de cada migración que cree tablas operativas. Ejecutar como:
--   psql "$DATABASE_URL" -f prisma/rls/001_enable_rls.sql
--
-- Requiere un rol de aplicación SIN privilegio BYPASSRLS (nunca el superuser):
--   CREATE ROLE kobrax_app LOGIN PASSWORD '...';

-- Helper: account_id del contexto actual (NULL si no está seteado).
-- Devuelve text porque Prisma mapea los ids (String @default(uuid())) a columnas
-- de tipo text, no al tipo uuid nativo de PostgreSQL.
-- DROP ... CASCADE elimina también las policies que dependen de la función;
-- el resto del script las vuelve a crear → script idempotente.
DROP FUNCTION IF EXISTS app_current_account() CASCADE;
CREATE FUNCTION app_current_account() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '');
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  t text;
  -- Tablas operativas con columna account_id.
  operational text[] := ARRAY[
    -- Pilar 1
    'branches', 'user_accounts', 'user_sessions', 'audit_logs',
    -- Pilar 2
    'clients', 'client_contacts', 'client_locations', 'client_relations',
    'client_attachments', 'credits', 'credit_installments', 'arrears',
    -- Pilar 3
    'collection_cases', 'case_activities', 'route_plans', 'route_stops',
    'field_visits', 'field_evidences',
    -- Pilar 4 + transversal
    'payments', 'payment_requests', 'notifications',
    -- Auth (F2a)
    'refresh_tokens'
  ];
BEGIN
  FOREACH t IN ARRAY operational LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (account_id = app_current_account()) WITH CHECK (account_id = app_current_account());',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO kobrax_app;', t);
  END LOOP;
END $$;

-- accounts: la raíz del tenant se ve a sí misma según el contexto.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self ON accounts;
CREATE POLICY tenant_self ON accounts
  USING (id = app_current_account())
  WITH CHECK (id = app_current_account());
GRANT SELECT, INSERT, UPDATE ON accounts TO kobrax_app;

-- user_permission_overrides: account_id es opcional (overrides globales).
ALTER TABLE user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permission_overrides FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_permission_overrides;
CREATE POLICY tenant_isolation ON user_permission_overrides
  USING (account_id IS NULL OR account_id = app_current_account());
GRANT SELECT, INSERT, UPDATE, DELETE ON user_permission_overrides TO kobrax_app;

-- Tablas GLOBALES (sin account_id): users, profiles, roles, permissions,
-- role_permissions. No llevan RLS por tenant; su acceso se controla en la
-- capa de aplicación (un usuario es global y puede pertenecer a varios tenants).
GRANT SELECT, INSERT, UPDATE, DELETE ON users, profiles, roles, permissions, role_permissions, mfa_backup_codes TO kobrax_app;
