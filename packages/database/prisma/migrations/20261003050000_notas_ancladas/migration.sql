-- Central de Mora: cada post-it se ancla a una **sección** de la ficha.
--
-- Hasta ahora `pos_x`/`pos_y` eran píxeles de la ventana: la nota se quedaba quieta mientras la ficha pasaba por
-- debajo. Ahora son píxeles **dentro de la sección** a la que pertenece (`anchor`), así que viaja con ella al
-- hacer scroll, y al plegar o mover la sección la nota la acompaña. `PAGE` es la ficha entera (el lugar donde ya
-- estaban todas las notas existentes). Idempotente.

DO $$ BEGIN
  CREATE TYPE "credit_note_anchor" AS ENUM ('PAGE', 'TIMELINE', 'PROMISES', 'NOTES', 'PAYMENTS', 'HISTORY', 'PERSON');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "credit_notes"
  ADD COLUMN IF NOT EXISTS "anchor" "credit_note_anchor" NOT NULL DEFAULT 'PAGE';
