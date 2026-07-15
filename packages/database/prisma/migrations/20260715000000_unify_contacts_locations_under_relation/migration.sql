-- Unifica teléfonos y ubicaciones: pertenecen al Cliente (relation_id NULL) o a un Contacto/relación
-- (relation_id set). Elimina los campos inline viejos de client_relations (phone, location_id).
-- RLS: sin cambios — client_contacts / client_locations ya tienen su policy por account_id.

-- 1. Nueva columna de propietario (relación) en teléfonos y ubicaciones.
ALTER TABLE "client_contacts"  ADD COLUMN "relation_id" TEXT;
ALTER TABLE "client_locations" ADD COLUMN "relation_id" TEXT;

-- 2. Baja de los campos inline de la relación (limpieza total).
ALTER TABLE "client_relations" DROP CONSTRAINT IF EXISTS "client_relations_location_id_fkey";
ALTER TABLE "client_relations" DROP COLUMN IF EXISTS "location_id";
ALTER TABLE "client_relations" DROP COLUMN IF EXISTS "phone";

-- 3. FKs de propiedad (ON DELETE SET NULL: borrar la relación no borra el teléfono/ubicación, lo desata).
ALTER TABLE "client_contacts"
  ADD CONSTRAINT "client_contacts_relation_id_fkey"
  FOREIGN KEY ("relation_id") REFERENCES "client_relations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "client_locations"
  ADD CONSTRAINT "client_locations_relation_id_fkey"
  FOREIGN KEY ("relation_id") REFERENCES "client_relations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Índices por propietario.
CREATE INDEX "client_contacts_account_id_relation_id_idx"  ON "client_contacts"("account_id", "relation_id");
CREATE INDEX "client_locations_account_id_relation_id_idx" ON "client_locations"("account_id", "relation_id");
