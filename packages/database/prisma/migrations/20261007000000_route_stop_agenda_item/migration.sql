-- F4/11 · Etapa 1 — una parada de ruta puede venir de una visita agendada.
--
-- `agenda_item_id` es una referencia suave (como el resto de los vínculos del agendado): la parada sabe de qué
-- gestión nació, y al visitarla el servidor cierra esa gestión en la misma transacción (una sola actividad).
ALTER TABLE "route_stops" ADD COLUMN "agenda_item_id" TEXT;

CREATE INDEX "route_stops_account_id_agenda_item_id_idx" ON "route_stops"("account_id", "agenda_item_id");

-- Una gestión entra a lo sumo en UNA parada activa: no se puede llevar la misma visita en dos rutas. Una parada
-- SALTEADA libera la gestión (se puede volver a planificar). Prisma no expresa índices parciales: vive solo acá.
CREATE UNIQUE INDEX "route_stops_agenda_item_active_key" ON "route_stops"("agenda_item_id")
  WHERE "agenda_item_id" IS NOT NULL AND "status" <> 'SKIPPED';
