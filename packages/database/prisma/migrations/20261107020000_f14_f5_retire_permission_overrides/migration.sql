-- F14 · F5 (H-4, ADR-F14-10) — se retira `user_permission_overrides`.
--
-- La tabla nunca tuvo lector ni escritor en la aplicación (la auditoría de F14 lo verificó: ningún servicio la consulta). Si algún día se necesita «un permiso
-- temporal a una persona», se reintroduce con `expires_at` y auditoría. APROBADO por la usuaria (2026-11-04).
--
-- SEGURIDAD DE LA MIGRACIÓN: si en ALGÚN entorno la tabla tiene filas, la migración se detiene en vez de borrarlas en silencio; quien la corre decide qué
-- hacer con esos datos (la H-4 pedía verificar que estuviera vacía en cada entorno antes de borrar).
-- ROLLBACK: la tabla estaba vacía; se recrea vacía con la definición de la migración inicial `20260616022844_init_pillars_1_to_4`.

DO $$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.user_permission_overrides') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM user_permission_overrides' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'user_permission_overrides tiene % filas: no se borra en silencio. Revisarlas antes de retirar la tabla (H-4).', n;
    END IF;
  END IF;
END $$;

DROP TABLE IF EXISTS "user_permission_overrides";
