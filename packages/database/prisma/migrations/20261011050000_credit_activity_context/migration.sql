-- F4/13 · E4 — Contexto de la gestión: por qué no pagó, cuándo espera cobrar y quién responde realmente.
--
-- ADITIVO y sin riesgo para lo existente: columnas NULABLES en `credit_activities` (que es append-only: no se reescribe
-- ninguna fila). Lo anterior queda en NULL. El tipo `data_origin` ya existe (migración del perfil de ingreso).

CREATE TYPE "payer_party" AS ENUM ('HOLDER', 'GUARANTOR', 'CODEBTOR', 'BENEFICIARY', 'NOT_LOCATED');

ALTER TABLE "credit_activities"
  ADD COLUMN "reason_code"          TEXT,
  ADD COLUMN "expected_income_date" DATE,
  ADD COLUMN "payer_party"          "payer_party",
  ADD COLUMN "origin"               "data_origin";

-- «Qué motivos hay y cuándo»: alerta de evento externo por zona y fecha, y tablas de qué funcionó.
CREATE INDEX "credit_activities_account_id_reason_code_created_at_idx"
  ON "credit_activities"("account_id", "reason_code", "created_at");
