-- Central de Mora (F4/07 · T12): notas por crédito, independientes del caso.
--
-- Hasta ahora la única «nota» era `case_activities.notes`: atada a un caso y a un tipo de gestión, y sin
-- dónde dejar algo sobre un crédito en mora que todavía no tiene caso. Idempotente.
--
-- ⚠️ NO escribe la policy de RLS (igual que `credit_assignments`): se activa con `prisma/rls/001_enable_rls.sql`,
-- que ya lista la tabla. Volver a correrla después de aplicar esto (también da el GRANT al rol de la API).

DO $$ BEGIN
  CREATE TYPE "credit_note_kind" AS ENUM ('INFO', 'WARNING', 'IMPORTANT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "credit_notes" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "credit_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "author_id" TEXT,
    "kind" "credit_note_kind" NOT NULL DEFAULT 'INFO',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id"),
    -- Una nota vacía no es una nota, y una de varias páginas no es una nota sino un documento.
    CONSTRAINT "credit_notes_largo" CHECK (char_length(btrim("body")) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS "credit_notes_account_id_credit_id_created_at_idx"
    ON "credit_notes"("account_id", "credit_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "credit_notes_account_id_client_id_idx" ON "credit_notes"("account_id", "client_id");

DO $$ BEGIN
  ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
