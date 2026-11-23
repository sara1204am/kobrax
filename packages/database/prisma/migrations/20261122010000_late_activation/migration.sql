-- F17 · F3-e — activación explícita del interés moratorio en un crédito existente (D8) + permiso `payment:activate_late`.
--
-- Un crédito nace con la política de su cuenta sellada (inmutable por trigger). Si nació sin mora (`NONE`), el único modo de cobrársela a futuro
-- es un HECHO nuevo: esta tabla. Una fila por crédito (única), append-only; sella la política `ANNUAL_RATE` vigente al activar y el primer día en que
-- puede correr el devengo (`starts_on`, que la API exige posterior al día de la activación: nunca retroactivo). No se toca `credits.late_policy_version_id`.
--
-- ROLLBACK: DROP TABLE credit_late_activations; borrar el permiso `payment:activate_late` (y sus role_permissions).

CREATE TABLE "credit_late_activations" (
    "id"                TEXT NOT NULL,
    "account_id"        TEXT NOT NULL,
    "credit_id"         TEXT NOT NULL,
    "policy_version_id" TEXT NOT NULL,
    "starts_on"         DATE NOT NULL,
    "reason"            TEXT NOT NULL,
    "created_by"        TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_late_activations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_late_activations_reason_given" CHECK (length(btrim("reason")) >= 3)
);

CREATE UNIQUE INDEX "credit_late_activations_credit_id_key" ON "credit_late_activations"("credit_id");
CREATE INDEX "credit_late_activations_account_id_credit_id_idx" ON "credit_late_activations"("account_id", "credit_id");

ALTER TABLE "credit_late_activations"
    ADD CONSTRAINT "credit_late_activations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "credit_late_activations_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "credit_late_activations_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "late_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una activación es un hecho: para la aplicación no se edita ni se borra (el mantenimiento como propietario queda fuera, como en `late_policy_versions`).
CREATE OR REPLACE FUNCTION credit_late_activations_guard_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('kobrax_app', 'kobrax_scoped') THEN
    RAISE EXCEPTION 'credit_late_activations es inmutable: % no permitido', TG_OP USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER credit_late_activations_immutable BEFORE UPDATE OR DELETE ON credit_late_activations
  FOR EACH ROW EXECUTE FUNCTION credit_late_activations_guard_mutation();

-- ── Permiso ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO "permissions" ("id", "name", "code", "module", "action", "scope", "active", "updated_at")
VALUES (gen_random_uuid(), 'payment:activate_late', 'payment:activate_late', 'payments', 'EXECUTE', 'ACCOUNT', true, now())
ON CONFLICT ("code") DO NOTHING;

UPDATE "permissions" SET "risk" = 'HIGH'::"PermissionRisk", "reserved" = NULL, "requires" = '["payment:read"]'::jsonb WHERE "code" = 'payment:activate_late';

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" = 'payment:activate_late'
WHERE r."name" IN ('SUPER_ADMIN', 'ACCOUNT_ADMIN')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

UPDATE "platform_settings" SET "policy_version" = "policy_version" + 1, "updated_at" = now() WHERE "id" = 1;
