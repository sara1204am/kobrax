-- Funciones de soporte de autenticación.
-- El login necesita leer las membresías de un usuario ACROSS tenants (para saber
-- a qué empresas pertenece) ANTES de fijar un contexto de tenant. Eso choca con la
-- RLS de user_accounts. Se resuelve con una función SECURITY DEFINER acotada:
-- corre con los privilegios del owner (postgres → bypassa RLS) pero SOLO devuelve
-- las membresías del user_id solicitado. kobrax_app recibe únicamente EXECUTE.
--
-- Aplicar (como superuser) tras las migraciones:
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -f - < prisma/rls/002_auth_functions.sql

CREATE OR REPLACE FUNCTION auth_memberships(p_user_id text)
RETURNS TABLE (
  user_account_id text,
  account_id      text,
  role_id         text,
  branch_id       text,
  is_default      boolean,
  is_owner        boolean,
  account_name    text,
  account_status  text,
  role_name       text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT ua.id, ua.account_id, ua.role_id, ua.branch_id, ua.is_default, ua.is_owner,
         a.business_name, a.account_status::text, r.name
  FROM user_accounts ua
  JOIN accounts a ON a.id = ua.account_id
  JOIN roles r ON r.id = ua.role_id
  WHERE ua.user_id = p_user_id
    AND ua.is_active = true
    AND a.deleted_at IS NULL
  ORDER BY ua.is_default DESC, a.business_name ASC;
$$;

REVOKE ALL ON FUNCTION auth_memberships(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_memberships(text) TO kobrax_app;
