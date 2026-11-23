-- Imputación de pagos a cuotas — `payment_applications` (auditoría «Mora vs Cartera»).
--
-- POR QUÉ
-- Un pago se aplicaba a las cuotas sólo mutando `credit_installments.paid_amount/status`, y sólo si el crédito tenía cronograma
-- guardado. Un crédito con condiciones y cuota fija NO lo tiene (el plan se regenera con `calculateCredit`), así que el pago movía
-- el saldo y nada más: ningún rastro de a qué cuota fue cada centavo. Esta tabla guarda ese reparto como un HECHO, en el orden
-- de REGISTRO del pago, igual que `payments` guarda el cobro. El estado de cada cuota se deriva del plan original + la suma de
-- estas filas; las columnas de `credits` y de `credit_installments` quedan como copias de lectura.
--
-- INMUTABLE (como `payments`): la aplicación (kobrax_app / kobrax_scoped) sólo inserta y lee. Una corrección se compensa con filas
-- `REVERSAL` de monto negativo, nunca editando. La anulación de pagos todavía no existe; las columnas quedan preparadas.
--
-- ALCANCE (F14·F2b): `credit_branch_id` / `credit_manager_id` se copian del crédito por trigger, igual que en `payments`, para que
-- la barrera RLS (`rls/006`) no consulte `credits` fila por fila. Los permisos (REVOKE) y la policy viven en `rls/`: correr `db:rls`.
--
-- ROLLBACK: aditivo. DROP TABLE "payment_applications"; DROP TYPE "payment_application_kind"; volver a crear
-- `credits_push_scope_owner()` como en 20261106010000.

CREATE TYPE "payment_application_kind" AS ENUM ('APPLY', 'REVERSAL');

CREATE TABLE "payment_applications" (
    "id"                 TEXT NOT NULL,
    "account_id"         TEXT NOT NULL,
    "payment_id"         TEXT NOT NULL,
    "credit_id"          TEXT NOT NULL,
    "installment_number" INTEGER NOT NULL,
    "amount"             DECIMAL(14,2) NOT NULL,
    "kind"               "payment_application_kind" NOT NULL DEFAULT 'APPLY',
    "reverses_id"        TEXT,
    "policy_version"     SMALLINT NOT NULL DEFAULT 1,
    "credit_branch_id"   TEXT,
    "credit_manager_id"  TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_applications_pkey" PRIMARY KEY ("id"),
    -- Una aplicación suma y una compensación resta; nunca 0.
    CONSTRAINT "payment_applications_amount_sign" CHECK (
        ("kind" = 'APPLY' AND "amount" > 0) OR ("kind" = 'REVERSAL' AND "amount" < 0)
    ),
    -- Sólo la compensación apunta a otra aplicación.
    CONSTRAINT "payment_applications_reversal_ref" CHECK (("kind" = 'REVERSAL') = ("reverses_id" IS NOT NULL)),
    CONSTRAINT "payment_applications_installment_positive" CHECK ("installment_number" > 0)
);

-- Un pago se aplica UNA vez a cada cuota (por tipo): la barrera contra la doble aplicación de un mismo movimiento.
CREATE UNIQUE INDEX "payment_applications_payment_id_installment_number_kind_key"
    ON "payment_applications"("payment_id", "installment_number", "kind");
CREATE INDEX "payment_applications_account_id_credit_id_installment_number_idx"
    ON "payment_applications"("account_id", "credit_id", "installment_number");
CREATE INDEX "payment_applications_account_id_payment_id_idx"
    ON "payment_applications"("account_id", "payment_id");

ALTER TABLE "payment_applications"
    ADD CONSTRAINT "payment_applications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "payment_applications_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Integridad que un CHECK no puede expresar ─────────────────────────────────────────────────────────────────────────────────
-- El crédito de la fila es el del pago (la columna se denormaliza para el alcance y los reportes por crédito); y una compensación
-- apunta a una aplicación REAL, del mismo pago y de la misma cuota. SECURITY DEFINER: lee `payments` sin que la barrera de alcance
-- del que inserta le oculte la fila.
CREATE OR REPLACE FUNCTION payment_applications_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p_credit text;
  r_payment text; r_installment int; r_kind text;
BEGIN
  SELECT credit_id INTO p_credit FROM payments WHERE id = NEW.payment_id;
  IF p_credit IS NULL OR p_credit <> NEW.credit_id THEN
    RAISE EXCEPTION 'payment_applications: el crédito de la aplicación no es el del pago' USING ERRCODE = '23514';
  END IF;
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT payment_id, installment_number, kind::text INTO r_payment, r_installment, r_kind
      FROM payment_applications WHERE id = NEW.reverses_id;
    IF r_payment IS NULL OR r_kind <> 'APPLY' OR r_payment <> NEW.payment_id OR r_installment <> NEW.installment_number THEN
      RAISE EXCEPTION 'payment_applications: la compensación debe apuntar a una aplicación del mismo pago y la misma cuota' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_applications_check_ins BEFORE INSERT ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION payment_applications_check();

-- ── Alcance: la fila copia oficina y responsable de su crédito al nacer (la misma función que `payments`) ────────────────────────
CREATE TRIGGER payment_applications_scope_copy BEFORE INSERT OR UPDATE OF credit_id ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION scope_copy_credit_owner();

-- ── Cuando el crédito cambia de oficina o de responsable, también se actualizan sus aplicaciones ─────────────────────────────────
-- (misma función que 20261106010000, con un UPDATE más). Un crédito dado de baja deja las copias en NULL.
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
  UPDATE agenda_items SET credit_branch_id = v_branch, credit_manager_id = v_manager
  WHERE credit_id = NEW.id AND (credit_branch_id IS DISTINCT FROM v_branch OR credit_manager_id IS DISTINCT FROM v_manager);
  RETURN NULL;
END;
$$;

-- ── Inmutabilidad: la aplicación sólo puede actualizar las copias de alcance; jamás DELETE ───────────────────────────────────────
-- Quien administra la base (propietario, migraciones, soporte) queda fuera a propósito, como en `payments`.
CREATE OR REPLACE FUNCTION payment_applications_guard_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mutable_cols text[] := ARRAY['credit_branch_id', 'credit_manager_id'];
BEGIN
  IF current_user NOT IN ('kobrax_app', 'kobrax_scoped') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment_applications es inmutable: DELETE no permitido' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - mutable_cols) IS DISTINCT FROM (to_jsonb(OLD) - mutable_cols) THEN
    RAISE EXCEPTION 'payment_applications es inmutable: sólo se pueden actualizar % ', mutable_cols USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_applications_immutable BEFORE UPDATE OR DELETE ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION payment_applications_guard_mutation();
