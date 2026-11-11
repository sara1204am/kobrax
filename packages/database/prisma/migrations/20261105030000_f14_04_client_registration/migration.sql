-- F14 · F2 — oficina de registro del cliente (H-7: el cliente NO tiene dueño; esto es trazabilidad y visibilidad por oficina).
-- Aditiva: una columna nullable, su FK y un índice. Reversible (DROP COLUMN).
ALTER TABLE "clients" ADD COLUMN "registered_branch_id" TEXT;

ALTER TABLE "clients"
  ADD CONSTRAINT "clients_registered_branch_id_fkey"
  FOREIGN KEY ("registered_branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "clients_account_id_registered_branch_id_idx" ON "clients"("account_id", "registered_branch_id");

-- Backfill idempotente: la oficina de registro es la única oficina en que están TODOS los créditos vivos del cliente.
-- Si el cliente no tiene créditos vivos, o los tiene en varias oficinas, o alguno sin oficina, queda NULL y se lista en
-- verify/f14-cliente-registro.sql para decidirlo a mano (no se adivina).
UPDATE "clients" c
SET "registered_branch_id" = s."branch_id"
FROM (
  SELECT cr."client_id", MIN(cr."branch_id") AS "branch_id"
  FROM "credits" cr
  WHERE cr."deleted_at" IS NULL
  GROUP BY cr."client_id"
  HAVING COUNT(*) FILTER (WHERE cr."branch_id" IS NULL) = 0 AND COUNT(DISTINCT cr."branch_id") = 1
) s
WHERE c."id" = s."client_id" AND c."registered_branch_id" IS NULL;
