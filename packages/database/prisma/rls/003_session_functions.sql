-- Funciones de soporte para gestión de cuenta (F2b).
--
-- `GET /auth/sessions` y la revocación masiva (reset/change password, "cerrar todas")
-- necesitan leer las sesiones de un usuario ACROSS tenants. user_sessions tiene RLS
-- por account_id, así que se resuelve con una función SECURITY DEFINER acotada al
-- user_id solicitado (mismo patrón que auth_memberships).
--
-- Aplicar (como superuser) tras las migraciones:
--   docker exec -i kobrax-postgres psql -U postgres -d kobrax -f - < prisma/rls/003_session_functions.sql

CREATE OR REPLACE FUNCTION auth_user_sessions(p_user_id text)
RETURNS TABLE (
  session_id   text,
  account_id   text,
  account_name text,
  ip_address   text,
  device_name  text,
  device_type  text,
  os           text,
  city         text,
  country      text,
  login_at     timestamp,
  last_seen_at timestamp,
  expires_at   timestamp
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.account_id, a.business_name, s.ip_address, s.device_name, s.device_type,
         s.os, s.city, s.country, s.login_at, s.last_seen_at, s.expires_at
  FROM user_sessions s
  JOIN accounts a ON a.id = s.account_id
  WHERE s.user_id = p_user_id
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR now() < s.expires_at)
  ORDER BY s.last_seen_at DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION auth_user_sessions(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_user_sessions(text) TO kobrax_app;

-- GRANT para la tabla global de reset (sin RLS; acceso controlado en la app).
GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO kobrax_app;
