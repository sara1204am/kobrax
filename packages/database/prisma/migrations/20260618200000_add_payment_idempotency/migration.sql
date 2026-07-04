-- F7 · Idempotencia de pagos (anti doble registro por reintento de red).
ALTER TABLE "payments" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "payments_account_id_idempotency_key_key" ON "payments"("account_id", "idempotency_key");
