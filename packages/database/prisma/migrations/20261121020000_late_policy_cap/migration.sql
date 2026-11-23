-- D5 (F17): tope acumulado OPCIONAL del interés moratorio por cuota, como % del capital vencido de esa cuota.
-- Aditivo: la columna nace NULL (sin tope) y no toca ninguna versión existente. Sólo tiene sentido con `ANNUAL_RATE`.
-- ROLLBACK: ALTER TABLE "late_policy_versions" DROP CONSTRAINT "late_policy_versions_cap"; ALTER TABLE "late_policy_versions" DROP COLUMN "cap_pct_of_principal";
ALTER TABLE "late_policy_versions" ADD COLUMN "cap_pct_of_principal" DECIMAL(7,4);
ALTER TABLE "late_policy_versions" ADD CONSTRAINT "late_policy_versions_cap" CHECK (
    "cap_pct_of_principal" IS NULL OR ("kind" = 'ANNUAL_RATE' AND "cap_pct_of_principal" > 0)
);
