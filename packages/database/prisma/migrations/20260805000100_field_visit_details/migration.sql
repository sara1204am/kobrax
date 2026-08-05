-- Rutas S5 (RT-6): campos propios de cada variante del sheet de resultado.
--
-- Mismo patrón que `agenda_items.details` (decisión 2 del módulo agenda): un JSONB validado en
-- `packages/shared`, en vez de una columna por qualifier (canal intentado, aviso dejado, categoría
-- especial…) o una tabla por variante.
--
-- `field_visits` es INMUTABLE por diseño (no tiene updated_at ni deleted_at): la columna es nullable
-- y sólo se escribe en el INSERT. No se agrega ningún camino de UPDATE.
ALTER TABLE "field_visits" ADD COLUMN "details" JSONB;
