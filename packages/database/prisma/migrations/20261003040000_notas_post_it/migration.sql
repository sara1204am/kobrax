-- Central de Mora: las notas del crédito pasan a ser post-its sobre un tablero (como las de Gallium).
--
-- Cada nota guarda su color y dónde está en el tablero (posición, tamaño y orden de apilado), y ahora se
-- pueden editar y borrar. El borrado es lógico (`deleted_at`): una nota es parte del rastro del crédito.
-- Las notas que ya existían quedan amarillas y escalonadas en cascada para que no queden apiladas. Idempotente.

DO $$ BEGIN
  CREATE TYPE "credit_note_color" AS ENUM ('YELLOW', 'PINK', 'BLUE', 'GREEN', 'PURPLE', 'ORANGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "credit_notes"
  ADD COLUMN IF NOT EXISTS "color" "credit_note_color" NOT NULL DEFAULT 'YELLOW',
  ADD COLUMN IF NOT EXISTS "pos_x" INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS "pos_y" INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS "width" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS "height" INTEGER NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS "z_index" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

-- Las notas viejas, en cascada por crédito (de la más antigua a la más nueva).
WITH ordered AS (
  SELECT "id", (row_number() OVER (PARTITION BY "credit_id" ORDER BY "created_at", "id") - 1) AS n
  FROM "credit_notes"
)
UPDATE "credit_notes" cn
   SET "pos_x" = 40 + (o.n % 5) * 26, "pos_y" = 40 + (o.n % 5) * 22, "z_index" = o.n + 1
  FROM ordered o
 WHERE cn."id" = o."id" AND cn."pos_x" = 40 AND cn."pos_y" = 40 AND cn."z_index" = 1;

DO $$ BEGIN
  ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tablero" CHECK (
    "pos_x" >= 0 AND "pos_y" >= 0 AND "width" BETWEEN 160 AND 520 AND "height" BETWEEN 120 AND 440 AND "z_index" >= 0
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
