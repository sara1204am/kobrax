-- Plataforma: listar las cuentas de TODAS las empresas (la consola de plataforma).
--
-- `accounts` tiene RLS por tenant: sin contexto de cuenta la aplicación no ve ninguna fila. Para que la persona de plataforma pueda buscar una
-- cuenta a la que suspender o reactivar, se usa una función SECURITY DEFINER acotada (mismo patrón que `auth_memberships`): corre con los
-- privilegios del dueño, devuelve SOLO lo necesario para identificar la cuenta (nombre, estado, plan, fecha y correo del titular), nunca datos de
-- cartera ni de personas deudoras, y limita el tamaño del resultado. `kobrax_app` recibe únicamente EXECUTE; el controlador que la llama exige un
-- token de plataforma (`platform:accounts:read`), que ningún rol de empresa tiene.
--
-- 🔴 Corre ANTES de 006_scope_policies.sql. Idempotente.

CREATE OR REPLACE FUNCTION platform_list_accounts(p_query text, p_limit integer)
RETURNS TABLE (
  account_id     text,
  business_name  text,
  account_status text,
  plan_code      text,
  created_at     timestamp,
  owner_email    text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT a.id, a.business_name, a.account_status::text, a.plan_code::text, a.created_at,
         (SELECT u.email
            FROM user_accounts ua
            JOIN users u ON u.id = ua.user_id
           WHERE ua.account_id = a.id AND ua.is_owner = true
           ORDER BY ua.created_at ASC
           LIMIT 1)
  FROM accounts a
  WHERE a.deleted_at IS NULL
    AND (p_query IS NULL OR p_query = '' OR a.business_name ILIKE '%' || replace(replace(p_query, '%', ''), '_', '') || '%')
  ORDER BY a.business_name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

REVOKE ALL ON FUNCTION platform_list_accounts(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_list_accounts(text, integer) TO kobrax_app;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_scoped') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION platform_list_accounts(text, integer) TO kobrax_scoped';
  END IF;
END $$;
