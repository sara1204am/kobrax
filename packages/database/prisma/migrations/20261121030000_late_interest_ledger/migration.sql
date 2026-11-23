-- F17 · F3-b — Libro del interés moratorio. SÓLO ESQUEMA: ningún código lo usa todavía, así que no cambia ningún comportamiento.
--
-- 1) `payment_applications.component`: qué parte de la cuota cubrió la aplicación. `SCHEDULED` es lo de siempre (capital + interés corriente de la
--    cuota); `LATE_INTEREST` es interés moratorio. Todas las filas existentes quedan `SCHEDULED` (DEFAULT): migración aditiva, sin tocar datos.
--    El único pasa a incluir el componente: un mismo pago puede aplicar a la MISMA cuota una parte de mora y otra programada.
--
-- 2) `credit_late_waivers`: exoneraciones de mora. Una exoneración es un HECHO (quién, cuándo, cuánto, por qué), no una edición: append-only,
--    con la misma barrera de alcance (oficina/responsable del crédito) y la misma inmutabilidad que `payment_applications`.
--
-- ROLLBACK: DROP TABLE credit_late_waivers; recrear el único anterior; ALTER TABLE payment_applications DROP COLUMN component; DROP TYPE payment_application_component.
--           (credits_push_scope_owner vuelve a la versión de 20261120230000.)

CREATE TYPE "payment_application_component" AS ENUM ('SCHEDULED', 'LATE_INTEREST');

ALTER TABLE "payment_applications" ADD COLUMN "component" "payment_application_component" NOT NULL DEFAULT 'SCHEDULED';

DROP INDEX "payment_applications_payment_id_installment_number_kind_key";
CREATE UNIQUE INDEX "payment_applications_payment_inst_kind_comp_key"
    ON "payment_applications"("payment_id", "installment_number", "kind", "component");

-- ── Exoneraciones ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE "credit_late_waivers" (
    "id"                 TEXT NOT NULL,
    "account_id"         TEXT NOT NULL,
    "credit_id"          TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "amount"             DECIMAL(14,2) NOT NULL,
    "reason"             TEXT NOT NULL,
    "created_by"         TEXT,
    "credit_branch_id"   TEXT,
    "credit_manager_id"  TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_late_waivers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_late_waivers_amount_pos" CHECK ("amount" > 0),
    CONSTRAINT "credit_late_waivers_installment_pos" CHECK ("installment_number" > 0),
    -- Sin motivo no hay exoneración: queda en la auditoría y en la ficha.
    CONSTRAINT "credit_late_waivers_reason_given" CHECK (length(btrim("reason")) >= 3)
);

CREATE INDEX "credit_late_waivers_account_id_credit_id_installment_number_idx"
    ON "credit_late_waivers"("account_id", "credit_id", "installment_number");

ALTER TABLE "credit_late_waivers"
    ADD CONSTRAINT "credit_late_waivers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "credit_late_waivers_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Alcance: la fila copia oficina y responsable de su crédito al nacer (la misma función que `payments` y `payment_applications`).
CREATE TRIGGER credit_late_waivers_scope_copy BEFORE INSERT OR UPDATE OF credit_id ON credit_late_waivers
  FOR EACH ROW EXECUTE FUNCTION scope_copy_credit_owner();

-- Cuando el crédito cambia de oficina o de responsable, también se actualizan sus exoneraciones (misma función que 20261120230000, con un UPDATE más).
CREATE OR REPLACE FUNCTION credits_push_scope_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch  text := CASE WHEN NEW.deleted_at IS NULL THEN NEW.branch_id END;
  v_manager text := CASE WHEN NEW.deleted_at IS NULL THEN NEW.assigned_manager_id END;
BEGIN
  UPDATE payments SET credit_branch_id = v_branch, credit_manager_id = v_manager
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM v_branch OR credit_manager_id IS DISTINCT FROM v_manager);
  UPDATE payment_applications SET credit_branch_id = v_branch, credit_manager_id = v_manager
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM v_branch OR credit_manager_id IS DISTINCT FROM v_manager);
  UPDATE credit_late_waivers SET credit_branch_id = v_branch, credit_manager_id = v_manager
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM v_branch OR credit_manager_id IS DISTINCT FROM v_manager);
  UPDATE agenda_items SET credit_branch_id = v_branch, credit_manager_id = v_manager
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM v_branch OR credit_manager_id IS DISTINCT FROM v_manager);
  RETURN NULL;
END;
$$;

-- Inmutabilidad: la aplicación sólo puede actualizar las copias de alcance; jamás DELETE. El mantenimiento (propietario) queda fuera, como en `payments`.
CREATE OR REPLACE FUNCTION credit_late_waivers_guard_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable_cols text[] := ARRAY['credit_branch_id', 'credit_manager_id'];
BEGIN
  IF current_user NOT IN ('kobrax_app', 'kobrax_scoped') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit_late_waivers es inmutable: DELETE no permitido' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - mutable_cols) IS DISTINCT FROM (to_jsonb(OLD) - mutable_cols) THEN
    RAISE EXCEPTION 'credit_late_waivers es inmutable: sólo se pueden actualizar % ', mutable_cols USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_late_waivers_immutable BEFORE UPDATE OR DELETE ON credit_late_waivers
  FOR EACH ROW EXECUTE FUNCTION credit_late_waivers_guard_mutation();
