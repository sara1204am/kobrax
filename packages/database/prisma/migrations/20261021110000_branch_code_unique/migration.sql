-- Refactor de Cuenta · F6 — el código de una agencia es único dentro de la cuenta (entre las no borradas).
-- Parcial a propósito: una agencia dada de baja libera su código, y las que no tienen código no chocan entre sí.
CREATE UNIQUE INDEX "branches_account_id_code_key" ON "branches" ("account_id", "code") WHERE "code" IS NOT NULL AND "deleted_at" IS NULL;
