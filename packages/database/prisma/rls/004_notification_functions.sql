-- Funciones de soporte de notificaciones (F8).
-- El job PROMISE_DUE corre como tarea de sistema (sin contexto de tenant) y necesita
-- enumerar los tenants activos para escanear cada uno bajo su propia RLS. La tabla
-- `accounts` tiene RLS (tenant_self), así que se expone una función SECURITY DEFINER
-- acotada que SOLO devuelve ids de cuentas vivas. kobrax_app recibe únicamente EXECUTE.
--
-- Aplicar (como superuser) tras las migraciones:
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -f - < prisma/rls/004_notification_functions.sql

CREATE OR REPLACE FUNCTION promise_due_account_ids()
RETURNS TABLE (account_id text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT id FROM accounts WHERE deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION promise_due_account_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promise_due_account_ids() TO kobrax_app;
