-- F5 · Un solo caso ABIERTO por crédito (los CLOSED/WRITTEN_OFF y los borrados no cuentan).
-- Índice parcial único (Prisma no expresa la condición WHERE → se crea por SQL).
CREATE UNIQUE INDEX "collection_cases_account_credit_open_key"
  ON "collection_cases" ("account_id", "credit_id")
  WHERE status NOT IN ('CLOSED', 'WRITTEN_OFF') AND deleted_at IS NULL;
