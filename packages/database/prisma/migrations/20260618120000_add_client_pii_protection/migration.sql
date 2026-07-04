-- F4 Fase 0 · Protección de PII de cliente.
-- national_id / tax_id pasan a almacenar CIPHERTEXT (AES-256-GCM) desde la capa de
-- aplicación; el tipo TEXT no cambia. Se añade un blind index (HMAC) para poder
-- buscar/deduplicar por documento sin exponer el plaintext.

-- DropIndex: el índice no-único sobre el documento en claro ya no aplica.
DROP INDEX IF EXISTS "clients_account_id_national_id_idx";

-- AlterTable: columna del blind index (HMAC-SHA256 del documento).
ALTER TABLE "clients" ADD COLUMN "national_id_hash" TEXT;

-- CreateIndex: documento único por tenant vía el blind index.
-- (Los NULL no colisionan en Postgres → clientes sin documento conviven.)
CREATE UNIQUE INDEX "clients_account_id_national_id_hash_key" ON "clients"("account_id", "national_id_hash");
