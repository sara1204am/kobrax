-- F4 Fase 3 · Desglose capital/interés por cuota del cronograma.
ALTER TABLE "credit_installments" ADD COLUMN "principal" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "credit_installments" ADD COLUMN "interest" DECIMAL(14,2) NOT NULL DEFAULT 0;
