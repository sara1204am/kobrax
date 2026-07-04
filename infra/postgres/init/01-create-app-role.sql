-- Rol de aplicación de Kobrax.
-- Se ejecuta una sola vez, al inicializar el volumen de PostgreSQL.
--
-- IMPORTANTE: NOSUPERUSER + NOBYPASSRLS. La app NUNCA debe conectar como
-- superuser, porque el superuser ignora las políticas RLS (aislamiento por tenant).
-- Las migraciones/seed se ejecutan como 'postgres' (superuser); la API en runtime
-- conecta como 'kobrax_app' y queda sujeta a RLS (las tablas usan FORCE ROW LEVEL SECURITY).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app') THEN
    CREATE ROLE kobrax_app LOGIN PASSWORD 'kobrax_app_pwd' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT CONNECT ON DATABASE kobrax TO kobrax_app;
GRANT USAGE ON SCHEMA public TO kobrax_app;

-- Que los GRANTs apliquen también a las tablas que cree Prisma más adelante.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kobrax_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kobrax_app;
