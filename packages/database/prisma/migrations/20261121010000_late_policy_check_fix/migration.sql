-- Corrige la restricción de parámetros de `late_policy_versions`: en SQL un CHECK que da NULL se considera cumplido, así que un `ANNUAL_RATE`
-- sin tasa ni convención de días (NULL > 0 → NULL) pasaba. Se piden los valores de forma explícita.
ALTER TABLE "late_policy_versions" DROP CONSTRAINT "late_policy_versions_kind_params";
ALTER TABLE "late_policy_versions" ADD CONSTRAINT "late_policy_versions_kind_params" CHECK (
    ("kind" = 'NONE' AND "annual_rate" IS NULL AND "day_count" IS NULL)
    OR ("kind" = 'ANNUAL_RATE' AND "annual_rate" IS NOT NULL AND "annual_rate" > 0 AND "day_count" IS NOT NULL AND "day_count" IN (360, 365))
);
