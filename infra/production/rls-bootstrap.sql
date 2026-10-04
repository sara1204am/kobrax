-- Solo la funcion base de RLS, sin ninguna politica.
--
-- POR QUE EXISTE ESTE ARCHIVO:
-- Hay migraciones (la primera es 20260618160000_add_client_import_runs) que
-- crean politicas usando app_current_account(). Pero esa funcion se define en
-- prisma/rls/001_enable_rls.sql, que vive FUERA de migrations/ y se aplica
-- despues. Sobre una base vacia eso es un huevo-y-gallina:
--
--   migrar primero  -> ERROR: function app_current_account() does not exist
--   RLS primero     -> ERROR: relation "branches" does not exist
--                      (el DO loop de 001 hace ALTER TABLE sin comprobar que
--                       la tabla exista)
--
-- La salida es aplicar SOLO la funcion antes de migrar. El 001 completo corre
-- despues, cuando las tablas ya existen.
--
-- Es tambien la razon por la que `prisma migrate dev` no funciona en este repo:
-- su shadow database se crea vacia y no conoce esta funcion.
--
-- CREATE OR REPLACE y no DROP ... CASCADE a proposito: un DROP CASCADE se
-- llevaria puestas todas las politicas que ya dependen de la funcion. Aca solo
-- se garantiza que exista; 001_enable_rls.sql es el dueno de las politicas.
--
-- ARREGLO DE FONDO (no hecho, requiere tocar el historial de migraciones):
-- esta funcion deberia crearse en la PRIMERA migracion. Ahi desapareceria este
-- archivo y `migrate dev` volveria a funcionar.

CREATE OR REPLACE FUNCTION app_current_account() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '');
$$ LANGUAGE sql STABLE;
