-- F14 · F1 — funciones de soporte para la outbox de versiones de autorización.
--
-- El reconciliador (un trabajo de sistema, sin tenant) tiene que leer las filas pendientes de TODOS los tenants. La tabla tiene RLS por
-- `account_id`, así que se hace con funciones SECURITY DEFINER acotadas a esa tabla (mismo patrón que `auth_user_sessions`).

CREATE OR REPLACE FUNCTION authz_outbox_pending(p_limit integer)
RETURNS TABLE (id text, account_id text, user_id text, version integer)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public
AS $$
  SELECT o.id, o.account_id, o.user_id, o.version
  FROM authz_version_outbox o
  WHERE o.processed_at IS NULL
  ORDER BY o.created_at
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
$$;

CREATE OR REPLACE FUNCTION authz_outbox_mark(p_ids text[])
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  WITH u AS (UPDATE authz_version_outbox SET processed_at = now() WHERE id = ANY(p_ids) AND processed_at IS NULL RETURNING 1)
  SELECT count(*)::integer FROM u;
$$;

-- Versión vigente de una membresía (para llenar Redis cuando falta la clave) sin necesitar el contexto del tenant.
CREATE OR REPLACE FUNCTION authz_membership_version(p_user_id text, p_account_id text)
RETURNS integer
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public
AS $$
  SELECT ua.authz_version FROM user_accounts ua WHERE ua.user_id = p_user_id AND ua.account_id = p_account_id;
$$;

REVOKE ALL ON FUNCTION authz_outbox_pending(integer), authz_outbox_mark(text[]), authz_membership_version(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz_outbox_pending(integer), authz_outbox_mark(text[]), authz_membership_version(text, text) TO kobrax_app;
