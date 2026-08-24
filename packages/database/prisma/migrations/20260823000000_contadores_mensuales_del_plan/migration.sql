-- L2 (LIMITES-BUILD-PLAN): fotos y gestiones se cuentan POR MES para avisar (nunca frenar).
-- Los índices existentes entran por (account_id, visit_id/case_id); el conteo mensual filtra por
-- created_at, así que sin estos dos cada foto nueva pagaría un scan de la cuenta entera.
CREATE INDEX "field_visits_account_id_created_at_idx" ON "field_visits"("account_id", "created_at");

CREATE INDEX "field_evidences_account_id_created_at_idx" ON "field_evidences"("account_id", "created_at");
